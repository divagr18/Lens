import { createServer } from "node:http";
import next from "next";
import { GoogleGenAI, MediaResolution, Modality } from "@google/genai";
import { WebSocketServer } from "ws";
import {
  curateTranscriptTurn,
  loadTravelMemory,
  normalizeLiveTrip,
  summarizeTripMemory,
} from "./live-memory.mjs";

const dev = process.argv.includes("--dev");
const hostname = process.env.HOSTNAME || "localhost";
const port = Number.parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });
const liveTestDurationMs = 110_000;
const maxAudioPayloadLength = 32_000;
const maxVideoPayloadLength = 2_000_000;
const liveMapsTools = [
  {
    functionDeclarations: [
      {
        name: "locate_me",
        description:
          "Use when the traveler asks where they are, what is nearby, or requests nearby landmarks. It returns nearby Places around the current phone GPS location.",
      },
      {
        name: "get_directions",
        description:
          "Use when the traveler asks how to get, walk, ride, or navigate to a specific destination. Resolve the named destination with Places and calculate a route from the current phone GPS location before answering.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            destination: {
              type: "string",
              description: "The destination name, address, or landmark spoken by the traveler.",
            },
            travel_mode: {
              type: "string",
              enum: ["TRANSIT", "WALK"],
              description: "Use WALK only when the traveler explicitly asks to walk; otherwise use TRANSIT.",
            },
          },
          required: ["destination"],
        },
      },
      {
        name: "search_places",
        description:
          "Use when the traveler asks for good places, restaurants, cafes, attractions, or other recommendations in a named neighborhood, road, or area. Search Places using the spoken query before answering. This does not require the traveler’s current GPS location.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              description: "The full place discovery query, including the requested type and area, such as 'good cafes on 12th Main Road, Indiranagar'.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_weather_forecast",
        description:
          "Use when the traveler asks about current weather, rain, heat, an umbrella, or a forecast. Use the phone GPS when no location is named; otherwise look up the named area before answering.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            location: {
              type: "string",
              description: "Optional named location or destination to forecast. Omit to forecast the current phone location.",
            },
          },
        },
      },
      {
        name: "get_traveler_memory",
        description:
          "Use when current traveler preferences, trip constraints, confirmed plans, or corrected details would materially change your answer. It returns the latest saved profile and trip memory.",
      },
      {
        name: "get_current_time",
        description:
          "Use when the traveler asks what time or day it is, whether they should leave now, or asks another time-sensitive question. It returns the current date and time in the phone's timezone.",
      },
      {
        name: "translate_visible_text",
        description:
          "Use when the traveler asks to translate the menu, sign, notice, placard, timetable, storefront, or other text currently visible in the camera. This opens the phone's visual translation lens without interrupting Live.",
      },
      {
        name: "start_city_game",
        description:
          "Use when the traveler asks to start a city game, scavenger hunt, or photo challenge. This opens a short public visual scavenger hunt for the selected trip city on the phone.",
      },
    ],
  },
];

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res);
});

wss.on("connection", (ws, req) => {
  const { pathname } = new URL(req.url || "/", `http://${req.headers.host}`);
  if (pathname === "/api/live/realtime") {
    attachRealtimeLiveSession(ws);
    return;
  }

  attachObservationSocket(ws);
});

function attachObservationSocket(ws) {
  sendJson(ws, {
    type: "status",
    status: "connected",
    transport: "local-websocket",
  });

  ws.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      sendJson(ws, { type: "error", error: "Invalid JSON message." });
      return;
    }

    if (payload.type !== "observation") {
      sendJson(ws, { type: "error", error: "Unsupported live message type." });
      return;
    }

    sendJson(ws, {
      type: "status",
      status: "processing",
      timestamp: payload.timestamp ?? 0,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/live/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      sendJson(ws, {
        type: res.ok ? "observation" : "error",
        ...body,
      });
    } catch (error) {
      sendJson(ws, {
        type: "error",
        error:
          error instanceof Error
            ? error.message
            : "Live proxy request failed.",
      });
    }
  });
}

function attachRealtimeLiveSession(ws) {
  let session;
  let phoneLocation;
  let phoneTimezone;
  let trip;
  let tripMemory = "";
  let currentMemoryContext = "";
  let pendingUserTranscript = "";
  let pendingAssistantTranscript = "";
  let curatorTimer;
  let curatorQueue = Promise.resolve();
  let stopping = false;
  let timeout;
  let metrics = { audioChunks: 0, audioBytes: 0, frames: 0, frameBytes: 0 };

  function closeSession(reason = "closed") {
    if (stopping) return;
    flushCuratorTurn();
    stopping = true;
    if (timeout) clearTimeout(timeout);
    if (curatorTimer) clearTimeout(curatorTimer);
    try {
      session?.close();
    } catch {
      // The browser socket is already closing; there is nothing actionable here.
    }
    sendJson(ws, { type: "closed", reason });
    if (ws.readyState === ws.OPEN) ws.close();
  }

  function sendMetrics() {
    sendJson(ws, { type: "metrics", ...metrics });
  }

  function appendTranscript(previous, next) {
    const text = typeof next === "string" ? next.trim() : "";
    if (!text || previous.endsWith(text)) return previous;
    return previous ? `${previous}\n${text}` : text;
  }

  function scheduleCuratorFlush() {
    if (curatorTimer) clearTimeout(curatorTimer);
    curatorTimer = setTimeout(flushCuratorTurn, 1_500);
  }

  function flushCuratorTurn() {
    if (curatorTimer) clearTimeout(curatorTimer);
    curatorTimer = undefined;
    const userText = pendingUserTranscript;
    const assistantText = pendingAssistantTranscript;
    pendingUserTranscript = "";
    pendingAssistantTranscript = "";
    if (!trip || !userText || !assistantText) return;

    curatorQueue = curatorQueue
      .then(async () => {
        sendJson(ws, { type: "memory-status", status: "curating", message: "Updating traveler memory…" });
        const result = await curateTranscriptTurn({ trip, userText, assistantText });
        if (result.status === "saved") {
          const additions = result.updates.map((update) => update.fact).join("\n");
          currentMemoryContext = [currentMemoryContext, additions].filter(Boolean).join("\n").slice(0, 6_000);
        }
        sendJson(ws, { type: "memory-status", status: result.status, message: result.message });
      })
      .catch((error) => {
        sendJson(ws, {
          type: "memory-status",
          status: "error",
          message: error instanceof Error ? error.message : "Memory curation failed.",
        });
      });
  }

  sendJson(ws, { type: "connected", transport: "laptop-websocket" });

  ws.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      sendJson(ws, { type: "error", code: "invalid-json", message: "Invalid JSON message." });
      return;
    }

    if (payload.type === "start") {
      if (session) {
        sendJson(ws, { type: "error", code: "already-started", message: "A Live test session is already running." });
        return;
      }
      if (!process.env.LIVE_TEST_TOKEN || payload.token !== process.env.LIVE_TEST_TOKEN) {
        sendJson(ws, { type: "error", code: "unauthorized", message: "The Live test code is missing or incorrect." });
        return;
      }
      if (!process.env.GEMINI_API_KEY) {
        sendJson(ws, { type: "error", code: "missing-api-key", message: "GEMINI_API_KEY is not configured on this laptop." });
        return;
      }

      phoneLocation = parsePhoneLocation(payload.location);
      phoneTimezone = parseTimezone(payload.timeZone);
      trip = normalizeLiveTrip(payload.trip);
      tripMemory = trip ? summarizeTripMemory(trip) : normalizeTripMemory(payload.tripMemory);
      currentMemoryContext = tripMemory;

      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        session = await ai.live.connect({
          model: process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
          config: {
            responseModalities: [Modality.AUDIO],
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: liveMapsTools,
            systemInstruction: buildLiveSystemInstruction(tripMemory),
          },
          callbacks: {
            onmessage(message) {
              if (message.toolCall?.functionCalls?.length && session) {
                void handleLiveMapsToolCalls({
                  session,
                  calls: message.toolCall.functionCalls,
                  phoneLocation,
                  phoneTimezone,
                  trip,
                  getMemoryContext: () => currentMemoryContext,
                  send: (payload) => sendJson(ws, payload),
                });
              }

              const content = message.serverContent;
              if (!content) return;

              if (content.interrupted) {
                sendJson(ws, { type: "interrupted" });
              }
              if (content.inputTranscription?.text) {
                sendJson(ws, { type: "input-transcript", text: content.inputTranscription.text, final: content.inputTranscription.finished ?? false });
                if (content.inputTranscription.finished) {
                  pendingUserTranscript = appendTranscript(pendingUserTranscript, content.inputTranscription.text);
                }
              }
              if (content.interimInputTranscription?.text) {
                sendJson(ws, { type: "input-transcript", text: content.interimInputTranscription.text, final: false });
              }
              if (content.outputTranscription?.text) {
                sendJson(ws, { type: "output-transcript", text: content.outputTranscription.text, final: content.outputTranscription.finished ?? false });
                if (content.outputTranscription.finished) {
                  pendingAssistantTranscript = appendTranscript(pendingAssistantTranscript, content.outputTranscription.text);
                  scheduleCuratorFlush();
                }
              }

              content.modelTurn?.parts?.forEach((part) => {
                if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) {
                  sendJson(ws, {
                    type: "output-audio",
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType,
                  });
                }
              });

              if (content.turnComplete) flushCuratorTurn();

            },
            onerror(error) {
              sendJson(ws, {
                type: "error",
                code: "gemini-live-error",
                message: error.message || "Gemini Live reported an unreadable error.",
              });
            },
            onclose(event) {
              if (!stopping) {
                closeSession(event.reason || "Gemini Live closed the session.");
              }
            },
          },
        });
        sendJson(ws, {
          type: "ready",
          model: process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
          maxDurationMs: liveTestDurationMs,
        });
        timeout = setTimeout(() => closeSession("Test session reached the 110 second limit."), liveTestDurationMs);
        if (trip) {
          void loadTravelMemory(trip).then((memory) => {
            if (memory.ok && memory.text) currentMemoryContext = `${tripMemory}\n${memory.text}`.slice(0, 6_000);
            sendJson(ws, {
              type: "memory-status",
              status: memory.ok ? "saved" : "skipped",
              message: memory.ok ? "Saved profile and trip memory ready." : memory.message,
            });
          });
        } else {
          sendJson(ws, { type: "memory-status", status: "skipped", message: "Select a saved trip to update memory during Live." });
        }
      } catch (error) {
        sendJson(ws, {
          type: "error",
          code: "connection-failed",
          message: error instanceof Error ? error.message : "Gemini Live connection failed.",
        });
      }
      return;
    }

    if (payload.type === "stop") {
      closeSession("Stopped on phone.");
      return;
    }

    if (payload.type === "location") {
      const nextLocation = parsePhoneLocation(payload.location);
      if (!nextLocation) {
        sendJson(ws, { type: "error", code: "invalid-location", message: "Phone location was malformed." });
        return;
      }
      phoneLocation = nextLocation;
      sendJson(ws, { type: "location", accuracy: phoneLocation.accuracy ?? null });
      return;
    }

    if (payload.type === "visual-translation-started") {
      sendJson(ws, { type: "tool-status", message: "Creating a translated visual copy…" });
      return;
    }

    if (payload.type === "visual-translation-finished") {
      sendJson(ws, {
        type: "tool-status",
        message: payload.ok ? "Translated visual is ready on your screen." : "Showing the extracted translation on your screen.",
      });
      return;
    }

    if (payload.type === "game-started") {
      sendJson(ws, { type: "tool-status", message: "City game ready on your screen." });
      return;
    }

    if (payload.type === "game-progress") {
      sendJson(ws, {
        type: "tool-status",
        message: payload.completed ? "Nice find — your city-game progress was updated." : "That target needs another photo.",
      });
      return;
    }

    if (!session || stopping) {
      sendJson(ws, { type: "error", code: "not-ready", message: "Start a Live test session before sending media." });
      return;
    }

    if (payload.type === "audio") {
      if (typeof payload.data !== "string" || payload.data.length > maxAudioPayloadLength) {
        sendJson(ws, { type: "error", code: "invalid-audio", message: "Audio chunk was missing or too large." });
        return;
      }
      try {
        session.sendRealtimeInput({
          audio: { data: payload.data, mimeType: "audio/pcm;rate=16000" },
        });
      } catch (error) {
        sendJson(ws, {
          type: "error",
          code: "audio-forward-failed",
          message: error instanceof Error ? error.message : "Could not forward audio to Gemini Live.",
        });
        closeSession("Audio forwarding failed.");
        return;
      }
      metrics.audioChunks += 1;
      metrics.audioBytes += Math.floor((payload.data.length * 3) / 4);
      if (metrics.audioChunks % 10 === 0) sendMetrics();
      return;
    }

    if (payload.type === "video") {
      if (typeof payload.data !== "string" || payload.data.length > maxVideoPayloadLength) {
        sendJson(ws, { type: "error", code: "invalid-video", message: "Camera frame was missing or too large." });
        return;
      }
      try {
        session.sendRealtimeInput({
          video: { data: payload.data, mimeType: "image/jpeg" },
        });
      } catch (error) {
        sendJson(ws, {
          type: "error",
          code: "video-forward-failed",
          message: error instanceof Error ? error.message : "Could not forward the camera frame to Gemini Live.",
        });
        closeSession("Video forwarding failed.");
        return;
      }
      metrics.frames += 1;
      metrics.frameBytes += Math.floor((payload.data.length * 3) / 4);
      sendMetrics();
      return;
    }

    sendJson(ws, { type: "error", code: "unsupported-message", message: "Unsupported realtime message type." });
  });

  ws.on("close", () => closeSession("Phone WebSocket closed."));
  ws.on("error", () => closeSession("Phone WebSocket errored."));
}

function parsePhoneLocation(location) {
  if (
    !location ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng) ||
    Math.abs(location.lat) > 90 ||
    Math.abs(location.lng) > 180
  ) {
    return undefined;
  }
  return {
    lat: location.lat,
    lng: location.lng,
    ...(Number.isFinite(location.accuracy) ? { accuracy: Math.max(0, location.accuracy) } : {}),
  };
}

async function handleLiveMapsToolCalls({ session, calls, phoneLocation, phoneTimezone, trip, getMemoryContext, send }) {
  const functionResponses = await Promise.all(
    calls.map(async (call) => {
      const name = call.name || "unknown_tool";
      send({ type: "tool-status", message: toolStatusMessage(name) });
      try {
        const output = await runLiveMapsTool({ name, args: call.args ?? {}, phoneLocation, phoneTimezone, trip, getMemoryContext, send });
        return { id: call.id, name, response: { output } };
      } catch (error) {
        return {
          id: call.id,
          name,
          response: {
            error: error instanceof Error ? error.message : "Maps tool execution failed.",
          },
        };
      }
    })
  );

  try {
    session.sendToolResponse({ functionResponses });
  } catch (error) {
    send({
      type: "error",
      code: "tool-response-failed",
      message: error instanceof Error ? error.message : "Could not return Maps data to Gemini Live.",
    });
  }
}

async function runLiveMapsTool({ name, args, phoneLocation, phoneTimezone, trip, getMemoryContext, send }) {
  if (name === "translate_visible_text") {
    send({ type: "visual-translation-request", targetLanguage: defaultTargetLanguage(trip?.languagePreferences) });
    return {
      action: "visual-translation-opened",
      message: "The phone is capturing the current view and will show the translated copy when it is ready.",
    };
  }
  if (name === "start_city_game") {
    send({ type: "city-game-request", city: trip?.destinationCity || "" });
    return {
      action: "city-game-opened",
      city: trip?.destinationCity || "selected city",
      message: "The phone is creating a short visual scavenger hunt.",
    };
  }
  if (name === "get_current_time") {
    return currentTimeForTimezone(phoneTimezone);
  }
  if (name === "get_traveler_memory") {
    return { memory: getMemoryContext?.() || "No saved traveler memory is available for this session." };
  }
  if (name === "get_weather_forecast") {
    const locationQuery = typeof args.location === "string" ? args.location.trim() : "";
    if (!phoneLocation && !locationQuery) {
      throw new Error("Phone location is unavailable. Ask the traveler to allow location access or name a weather location.");
    }
    return callLiveWeatherRoute({ location: phoneLocation, locationQuery: locationQuery || undefined });
  }

  if (name === "search_places") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) throw new Error("A place search query is required.");
    return callLiveMapsRoute({ action: "search_places", query, location: phoneLocation });
  }

  if (!phoneLocation) {
    throw new Error("Phone location is unavailable. Ask the traveler to allow location access, then try again.");
  }

  if (name === "locate_me") {
    return callLiveMapsRoute({ action: "locate_me", location: phoneLocation });
  }

  if (name === "get_directions") {
    const destination = typeof args.destination === "string" ? args.destination.trim() : "";
    if (!destination) throw new Error("A destination name is required for directions.");
    return callLiveMapsRoute({
      action: "get_directions",
      location: phoneLocation,
      destination,
      travelMode: args.travel_mode === "WALK" ? "WALK" : "TRANSIT",
    });
  }

  throw new Error(`Unsupported Maps tool: ${name}.`);
}

async function callLiveMapsRoute(payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/live/maps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({
    error: "Maps route returned unreadable JSON.",
  }));
  if (!response.ok || body.error) throw new Error(body.error || "Maps tool request failed.");
  return body;
}

async function callLiveWeatherRoute(payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/live/weather`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({
    error: "Weather route returned unreadable JSON.",
  }));
  if (!response.ok || body.error) throw new Error(body.error || "Weather tool request failed.");
  return body;
}

function toolStatusMessage(name) {
  if (name === "get_current_time") return "Checking the local time…";
  if (name === "get_traveler_memory") return "Checking your saved travel preferences…";
  if (name === "locate_me") return "Checking nearby Places from your phone location…";
  if (name === "get_directions") return "Finding the destination and calculating a route…";
  if (name === "search_places") return "Searching Places for recommendations…";
  if (name === "get_weather_forecast") return "Checking the weather forecast…";
  if (name === "translate_visible_text") return "Opening the visual translation lens…";
  if (name === "start_city_game") return "Creating a city game…";
  return "Looking up travel context…";
}

function normalizeTripMemory(memory) {
  return typeof memory === "string" ? memory.trim().slice(0, 6_000) : "";
}

function parseTimezone(timeZone) {
  if (typeof timeZone !== "string" || timeZone.length > 100) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return undefined;
  }
}

function currentTimeForTimezone(timeZone) {
  const resolvedTimeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = new Date();
  const dateTimeParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolvedTimeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const valueFor = (type) => dateTimeParts.find((part) => part.type === type)?.value || "";
  return {
    timeZone: resolvedTimeZone,
    localDate: `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`,
    localTime: `${valueFor("hour")}:${valueFor("minute")}:${valueFor("second")}`,
    weekday: valueFor("weekday"),
    utcOffset: valueFor("timeZoneName"),
    timestamp: now.toISOString(),
  };
}

function defaultTargetLanguage(preferences) {
  if (typeof preferences !== "string") return "English";
  const knownLanguages = ["English", "Hindi", "Kannada", "Tamil", "Telugu", "Japanese", "Korean", "French", "Spanish", "German", "Italian"];
  return knownLanguages.find((language) => preferences.toLowerCase().includes(language.toLowerCase())) || "English";
}

function buildLiveSystemInstruction(tripMemory) {
  return [
    "You are Lens, a concise real-time travel companion. Describe what you can see, answer spoken questions naturally, and say when the camera view is insufficient.",
    "Before calling a Maps, weather, or traveler-memory tool, first speak one brief natural acknowledgement such as 'Hmm, let me check that,' 'One second, I’ll look that up,' or 'Let me verify that for you.' Then call the tool immediately. Do this only for a tool lookup, say it once, and never imply a result before the tool returns.",
    "When asked where the traveler is, what is nearby, directions, or place recommendations, use the Maps tools before answering. Never invent a place or route.",
    "When asked about weather, rain, heat, an umbrella, or timing, use the weather tool before answering.",
    "When asked for the current date or time, whether to leave now, or another time-sensitive decision, use get_current_time instead of assuming the date or time.",
    "When the traveler asks to translate what is visible, use translate_visible_text. Briefly say you are preparing a translated copy, then let the phone show it; never claim the generated image is authoritative over the original.",
    "When the traveler asks for a city game or visual scavenger hunt, use start_city_game. The game must stay a safe public visual activity and must not require purchases, risky movement, private access, or photos of people.",
    "Use get_traveler_memory when saved preferences, corrections, or trip details could materially change the answer and the initial memory is insufficient.",
    "Turn tool results into practical advice. Apply the traveler memory below to every recommendation: protect their budget, avoid unsuitable walking or routes, account for luggage and dietary needs, and explain the relevant tradeoff. Do not give generic advice when memory changes the decision.",
    "If rain or heat makes the plan unsafe or impractical for the traveler’s mobility, say so plainly and offer a lower-walking, budget-aware alternative.",
    "Do not read raw coordinates unless asked.",
    "",
    "Traveler memory:",
    tripMemory || "No trip memory supplied for this Live test.",
  ].join("\n");
}

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url || "/", `http://${req.headers.host}`);
  if (pathname !== "/api/live" && pathname !== "/api/live/realtime") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

server.listen(port, () => {
  console.log(`Lens cockpit ready at http://${hostname}:${port}`);
});
