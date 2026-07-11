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
const wss = new WebSocketServer({ noServer: true });
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
        name: "generate_historical_scene",
        description:
          "Use only when the traveler explicitly asks for a short visual reconstruction or video about a historical event, battle, monument, or site. The request can be made from anywhere; do not require GPS, a known monument, a camera confirmation, or a specific trip location. This starts a separate phone-side generation and does not delay the Live conversation.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            topic: {
              type: "string",
              description: "The historical event, battle, monument, site, or question to visualize.",
            },
            context: {
              type: "string",
              description: "Optional concise context visible at the site or supplied by the traveler.",
            },
          },
          required: ["topic"],
        },
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
      {
        name: "get_city_game_status",
        description:
          "Use when the traveler asks what is left in their city treasure hunt, asks for the next target, or when game progress affects your answer. It returns the current uncompleted targets and score.",
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
// Access the prepared request handler directly. `getRequestHandler()` also
// installs an upgrade listener; this server routes upgrades itself so Next HMR
// and Lens Live cannot race to handle the same socket.
const handle = app.requestHandler;

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
  let cityGameContext = "";
  let pendingUserTranscript = "";
  let pendingAssistantTranscript = "";
  let curatorTimer;
  let curatorQueue = Promise.resolve();
  let stopping = false;
  let metrics = { audioChunks: 0, audioBytes: 0, frames: 0, frameBytes: 0 };

  function closeSession(reason = "closed") {
    if (stopping) return;
    flushCuratorTurn();
    stopping = true;
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
                  getGameContext: () => cityGameContext,
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
        });
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

    if (payload.type === "historical-video-started") {
      sendJson(ws, { type: "tool-status", message: "Creating the historical reconstruction…" });
      return;
    }

    if (payload.type === "historical-video-finished") {
      sendJson(ws, {
        type: "tool-status",
        message: payload.ok ? "The historical reconstruction is ready on your screen." : "The historical reconstruction could not be rendered.",
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

    if (payload.type === "game-context") {
      const nextGameContext = normalizeCityGameContext(payload.game);
      if (!nextGameContext) {
        sendJson(ws, { type: "error", code: "invalid-game-context", message: "City-game state was malformed." });
        return;
      }
      cityGameContext = nextGameContext;
      try {
        session.sendRealtimeInput({
          text: `[SYSTEM: current city treasure-hunt context. Use this silently for all relevant answers; do not announce this update unless asked.\n${cityGameContext}]`,
        });
      } catch (error) {
        sendJson(ws, {
          type: "error",
          code: "game-context-forward-failed",
          message: error instanceof Error ? error.message : "Could not update Gemini with the city-game state.",
        });
        return;
      }
      sendJson(ws, { type: "tool-status", message: "City treasure-hunt progress is synced." });
      return;
    }

    if (payload.type === "text") {
      if (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 4_000) {
        sendJson(ws, { type: "error", code: "invalid-text", message: "Text input was missing or too long." });
        return;
      }
      try {
        session.sendRealtimeInput({ text: payload.text.trim() });
      } catch (error) {
        sendJson(ws, {
          type: "error",
          code: "text-forward-failed",
          message: error instanceof Error ? error.message : "Could not forward text to Gemini Live.",
        });
      }
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

async function handleLiveMapsToolCalls({ session, calls, phoneLocation, phoneTimezone, trip, getMemoryContext, getGameContext, send }) {
  const functionResponses = await Promise.all(
    calls.map(async (call) => {
      const name = call.name || "unknown_tool";
      send({ type: "tool-status", message: toolStatusMessage(name) });
      try {
        const output = await runLiveMapsTool({ name, args: call.args ?? {}, phoneLocation, phoneTimezone, trip, getMemoryContext, getGameContext, send });
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

async function runLiveMapsTool({ name, args, phoneLocation, phoneTimezone, trip, getMemoryContext, getGameContext, send }) {
  if (name === "translate_visible_text") {
    send({ type: "visual-translation-request", targetLanguage: defaultTargetLanguage(trip?.languagePreferences) });
    return {
      action: "visual-translation-opened",
      message: "The phone is capturing the current view and will show the translated copy when it is ready.",
    };
  }
  if (name === "generate_historical_scene") {
    const topic = typeof args.topic === "string" ? args.topic.trim().slice(0, 500) : "";
    if (!topic) throw new Error("A historical topic is required before creating a reconstruction.");
    const context = typeof args.context === "string" ? args.context.trim().slice(0, 1_500) : "";
    send({ type: "historical-video-request", topic, ...(context ? { context } : {}) });
    return {
      action: "historical-video-opened",
      topic,
      message: "The phone is creating a short illustrative historical reconstruction separately from the Live conversation.",
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
  if (name === "get_city_game_status") {
    return { game: getGameContext?.() || "No city treasure hunt is active yet." };
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
  if (name === "get_city_game_status") return "Checking your remaining treasure-hunt targets.";
  if (name === "get_current_time") return "Checking the local time…";
  if (name === "get_traveler_memory") return "Checking your saved travel preferences…";
  if (name === "generate_historical_scene") return "Creating a historical reconstruction…";
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

function normalizeCityGameContext(game) {
  if (!game || typeof game !== "object") return "";
  const city = typeof game.city === "string" ? game.city.trim().slice(0, 120) : "";
  const score = typeof game.score === "number" && Number.isFinite(game.score) ? Math.max(0, Math.round(game.score)) : 0;
  const targets = Array.isArray(game.targets) ? game.targets : [];
  const remaining = targets
    .filter((target) => target && typeof target === "object" && target.completed !== true)
    .map((target) => {
      const title = typeof target.title === "string" ? target.title.trim().slice(0, 100) : "";
      const hint = typeof target.hint === "string" ? target.hint.trim().slice(0, 180) : "";
      return title ? `- ${title}${hint ? `: ${hint}` : ""}` : "";
    })
    .filter(Boolean)
    .slice(0, 5);
  if (!city || !targets.length) return "";
  return [
    `City treasure hunt: ${city}.`,
    `Score: ${score}. Remaining targets (${remaining.length}):`,
    remaining.length ? remaining.join("\n") : "All targets are complete.",
  ].join("\n");
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
    "When the traveler explicitly asks to see a historical event, battle, monument story, or reconstruction as a short video, use generate_historical_scene. This request is valid from anywhere: never require that they be at a particular monument, city, GPS location, or camera view. Use the event/site they name or describe as the topic. Briefly say that you are creating an illustrative reconstruction, not historical footage, then call the tool. Do not call it for a normal spoken historical explanation.",
    "When the traveler asks for a city game or visual scavenger hunt, use start_city_game. The game must stay a safe public visual activity and must not require purchases, risky movement, private access, or photos of people.",
    "A city treasure hunt may be active. The phone sends its current score and remaining targets as silent context updates. Retain that state for the whole session; use get_city_game_status for a fresh answer when asked what remains or what to find next.",
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
    // Next owns its development HMR socket (/_next/webpack-hmr) and any future
    // framework upgrade paths. Rejecting these here breaks hot reload.
    void app.upgradeHandler(req, socket, head);
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

server.listen(port, () => {
  console.log(`Lens cockpit ready at http://${hostname}:${port}`);
});
