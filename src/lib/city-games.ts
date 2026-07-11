import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "node:crypto";

const maxImageBytes = 3_000_000;
const gameLifetimeMs = 2 * 60 * 60 * 1_000;
const gameSessions = new Map<string, CityGameSession>();

const gameSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    targets: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          hint: { type: "string" },
          successCriteria: { type: "string" },
          points: { type: "number" },
        },
        required: ["title", "hint", "successCriteria", "points"],
      },
    },
  },
  required: ["targets"],
};

const validationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    match: { type: "boolean" },
    confidence: { type: "number" },
    feedback: { type: "string" },
  },
  required: ["match", "confidence", "feedback"],
};

export type CityGameTarget = {
  id: string;
  title: string;
  hint: string;
  successCriteria: string;
  points: number;
  completed: boolean;
};

export type CityGameSession = {
  gameId: string;
  city: string;
  createdAt: string;
  score: number;
  targets: CityGameTarget[];
};

export async function createCityGame(cityInput: string): Promise<CityGameSession> {
  const city = cleanCity(cityInput);
  if (!city) throw new Error("Choose a city before starting a game.");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured on this laptop.");
  pruneExpiredGames();

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_GAME_MODEL || process.env.GEMINI_MEMORY_MODEL || "gemini-3.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              `Create a 3 to 5 target public visual scavenger hunt for ${city}.`,
              "Each target must be a safe, culturally relevant thing a traveler can photograph from a public place: local transport, public signs, architecture, street-food cues, landmark motifs, or a recognizable public chain when appropriate.",
              "Never require a purchase, entry to a venue, trespassing, crossing traffic, risky movement, a time-sensitive condition, or photography of a person. Do not claim a specific business is open, nearby, or reachable.",
              "Use concrete visual evidence that a camera can validate. Keep titles and hints concise.",
              "Assign 50, 75, or 100 points per target.",
            ].join("\n"),
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json", responseJsonSchema: gameSchema },
  });
  const targets = parseGameTargets(response.text);
  if (targets.length < 3) throw new Error("Gemini did not produce enough safe city-game targets. Try again.");

  const session: CityGameSession = {
    gameId: randomUUID(),
    city,
    createdAt: new Date().toISOString(),
    score: 0,
    targets,
  };
  gameSessions.set(session.gameId, session);
  return copySession(session);
}

export async function validateCityGameAttempt({
  gameId,
  targetId,
  imageDataUrl,
}: {
  gameId: string;
  targetId: string;
  imageDataUrl: string;
}) {
  pruneExpiredGames();
  const session = gameSessions.get(gameId);
  if (!session) throw new Error("This city-game session has expired. Start a new game.");
  const target = session.targets.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error("That game target no longer exists.");
  if (target.completed) {
    return { completed: true, alreadyCompleted: true, confidence: 1, feedback: "Already completed.", game: copySession(session) };
  }
  const image = parseImageDataUrl(imageDataUrl);
  if (!image) throw new Error("Capture a JPEG or PNG image under 3 MB first.");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured on this laptop.");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_GAME_MODEL || process.env.GEMINI_MEMORY_MODEL || "gemini-3.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: image },
          {
            text: [
              "Validate one public visual scavenger-hunt photo.",
              `Target: ${target.title}`,
              `Required visual evidence: ${target.successCriteria}`,
              "Mark match true only when the required public object/sign/scene is clearly visible. Do not identify people or infer private facts. If uncertain, mark false and give a short, practical retry hint.",
            ].join("\n"),
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json", responseJsonSchema: validationSchema },
  });
  const verdict = parseVerdict(response.text);
  const completed = verdict.match && verdict.confidence >= 0.72;
  if (completed) {
    target.completed = true;
    session.score += target.points;
  }
  return { completed, alreadyCompleted: false, confidence: verdict.confidence, feedback: verdict.feedback, game: copySession(session) };
}

function parseGameTargets(text?: string): CityGameTarget[] {
  try {
    const parsed = JSON.parse(text ?? "{}") as { targets?: unknown };
    if (!Array.isArray(parsed.targets)) return [];
    return parsed.targets
      .map((target, index) => normalizeTarget(target, index))
      .filter((target): target is CityGameTarget => Boolean(target))
      .slice(0, 5);
  } catch {
    return [];
  }
}

function normalizeTarget(value: unknown, index: number): CityGameTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const target = value as Record<string, unknown>;
  const title = cleanText(target.title, 80);
  const hint = cleanText(target.hint, 180);
  const successCriteria = cleanText(target.successCriteria, 300);
  if (!title || !hint || !successCriteria) return undefined;
  const rawPoints = typeof target.points === "number" ? target.points : 50;
  const points = rawPoints >= 100 ? 100 : rawPoints >= 75 ? 75 : 50;
  return { id: `target-${index + 1}`, title, hint, successCriteria, points, completed: false };
}

function parseVerdict(text?: string) {
  try {
    const parsed = JSON.parse(text ?? "{}") as Record<string, unknown>;
    return {
      match: parsed.match === true,
      confidence: typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
      feedback: cleanText(parsed.feedback, 220) || "Try a clearer, closer photo of the target.",
    };
  } catch {
    throw new Error("Gemini returned an unreadable game validation.");
  }
}

function copySession(session: CityGameSession): CityGameSession {
  return { ...session, targets: session.targets.map((target) => ({ ...target })) };
}

function pruneExpiredGames() {
  const now = Date.now();
  gameSessions.forEach((session, gameId) => {
    if (now - Date.parse(session.createdAt) > gameLifetimeMs) gameSessions.delete(gameId);
  });
}

function cleanCity(value: string) {
  return cleanText(value, 120).replace(/[^\p{L}\p{N} ,.'-]/gu, "");
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function parseImageDataUrl(value: string) {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || Math.floor((match[2].length * 3) / 4) > maxImageBytes) return undefined;
  return { mimeType: match[1], data: match[2] };
}
