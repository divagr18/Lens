import { GoogleGenAI, Modality } from "@google/genai";
import { randomUUID } from "node:crypto";
import {
  LiveObservation,
  LiveTurnRequest,
  MapsContext,
  MemoryContext,
} from "@/lib/travel-types";

function dataUrlToBase64(dataUrl?: string) {
  if (!dataUrl) return null;
  const [, base64] = dataUrl.split(",");
  return base64 || null;
}

export async function runGeminiLiveTurn(
  request: LiveTurnRequest,
  context: MemoryContext
): Promise<LiveObservation> {
  const now = new Date().toISOString();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      id: randomUUID(),
      tripId: request.tripId,
      timestamp: request.timestamp,
      framePreview: request.frameDataUrl,
      userUtterance: request.question,
      retrievedMemories: context.memories,
      assistantAnswer:
        "GEMINI_API_KEY is not set, so the Gemini Live visual turn was not sent. Trip memory status is shown separately.",
      artifacts: [],
      status: "missing-api-key",
      transport: "unavailable",
      createdAt: now,
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const responseQueue: unknown[] = [];
  const frameBase64 = dataUrlToBase64(request.frameDataUrl);
  const prompt = buildTravelPrompt(request, context);

  try {
    const session = await ai.live.connect({
      model: process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
      callbacks: {
        onmessage(message) {
          responseQueue.push(message);
        },
        onerror(error) {
          responseQueue.push({ error: error.message });
        },
      },
      config: {
        responseModalities: [Modality.TEXT],
      },
    });

    if (frameBase64) {
      session.sendRealtimeInput({
        video: {
          data: frameBase64,
          mimeType: "image/jpeg",
        },
      });
    }

    session.sendRealtimeInput({ text: prompt });
    const answer = await collectLiveText(responseQueue, 12000);
    session.close();

    return {
      id: randomUUID(),
      tripId: request.tripId,
      timestamp: request.timestamp,
      framePreview: request.frameDataUrl,
      userUtterance: request.question,
      retrievedMemories: [
        ...context.profileStatic,
        ...context.profileDynamic,
        ...context.memories,
      ],
      assistantAnswer: answer || "Gemini Live returned no text for this turn.",
      artifacts: [],
      status: answer ? "ready" : "error",
      transport: answer ? "gemini-live" : "error",
      createdAt: now,
    };
  } catch (error) {
    return {
      id: randomUUID(),
      tripId: request.tripId,
      timestamp: request.timestamp,
      framePreview: request.frameDataUrl,
      userUtterance: request.question,
      retrievedMemories: context.memories,
      assistantAnswer:
        error instanceof Error
          ? `Gemini Live failed visibly: ${error.message}`
          : "Gemini Live failed visibly.",
      artifacts: [],
      status: "error",
      transport: "error",
      createdAt: now,
    };
  }
}

function buildTravelPrompt(request: LiveTurnRequest, context: MemoryContext) {
  return [
    "You are Lens, a PC prototype of a real-time AI travel companion for India city travel.",
    "Answer with contextual, action-oriented guidance. Respect allergies, diet, budget, hotel, timing, luggage, and itinerary memory.",
    "If the frame is not enough, say what you can infer and what the traveler should verify.",
    "",
    "Trip memory:",
    context.available
      ? [
          ...context.profileStatic,
          ...context.profileDynamic,
          ...context.memories,
        ].join("\n") || "No matching trip memory returned."
      : context.message,
    "",
    "Route and place context:",
    request.routeContext
      ? summarizeMapsContext(request.routeContext)
      : "No Maps route context supplied for this turn.",
    "",
    `Video timestamp: ${request.timestamp.toFixed(1)}s`,
    `Traveler asks: ${request.question}`,
  ].join("\n");
}

function summarizeMapsContext(context: MapsContext) {
  const route = context.route;
  const steps = route.steps
    .slice(0, 5)
    .map((step, index) => {
      const transit = step.transit
        ? ` (${[
            step.transit.lineName,
            step.transit.headsign,
            step.transit.departureStop &&
              step.transit.arrivalStop &&
              `${step.transit.departureStop} to ${step.transit.arrivalStop}`,
          ]
            .filter(Boolean)
            .join(", ")})`
        : "";
      return `${index + 1}. ${step.instruction}${transit}`;
    })
    .join("\n");
  const nearby = context.nearbyPlaces
    .slice(0, 5)
    .map((place) => `- ${place.displayName}: ${place.types.slice(0, 3).join(", ")}`)
    .join("\n");

  return [
    `Maps source: ${context.evidence.source}; status: ${context.evidence.status}`,
    `Origin: ${route.origin.label} (${route.origin.lat}, ${route.origin.lng})`,
    `Destination: ${route.destination.label} (${route.destination.lat}, ${route.destination.lng})`,
    `Travel mode: ${route.travelMode}${route.usedFallback ? " (fallback)" : ""}`,
    `ETA: ${route.durationText}; distance: ${route.distanceText}`,
    `Next step: ${route.nextStep}`,
    route.warnings.length ? `Warnings: ${route.warnings.join("; ")}` : "",
    steps ? `Route steps:\n${steps}` : "Route steps unavailable.",
    nearby ? `Nearby places:\n${nearby}` : "Nearby places unavailable.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function collectLiveText(queue: unknown[], timeoutMs: number) {
  const start = Date.now();
  const chunks: string[] = [];

  while (Date.now() - start < timeoutMs) {
    const message = queue.shift();
    if (!message) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    const candidate = message as {
      text?: string;
      error?: string;
      serverContent?: {
        turnComplete?: boolean;
        modelTurn?: { parts?: Array<{ text?: string }> };
      };
    };

    if (candidate.error) {
      throw new Error(candidate.error);
    }
    if (candidate.text) {
      chunks.push(candidate.text);
    }
    candidate.serverContent?.modelTurn?.parts?.forEach((part) => {
      if (part.text) chunks.push(part.text);
    });
    if (candidate.serverContent?.turnComplete) break;
  }

  return chunks.join("").trim();
}
