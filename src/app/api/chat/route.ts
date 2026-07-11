import { GoogleGenAI } from "@google/genai";
import type { TripProfile } from "@/lib/travel-types";

export const runtime = "nodejs";
export const maxDuration = 30;

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: unknown; history?: unknown; trip?: unknown };
    const message = cleanText(body.message, 4_000);
    if (!message) return Response.json({ error: "Write a message first." }, { status: 400 });
    if (!process.env.GEMINI_API_KEY) return Response.json({ error: "GEMINI_API_KEY is not configured on this laptop." }, { status: 503 });

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MEMORY_MODEL || "gemini-3.5-flash",
      contents: [{ role: "user", parts: [{ text: buildChatPrompt(message, normalizeHistory(body.history), normalizeTrip(body.trip)) }] }],
    });
    const answer = response.text?.trim();
    if (!answer) throw new Error("Gemini returned no chat response.");
    return Response.json({ answer });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Chat failed." },
      { status: 502 }
    );
  }
}

function buildChatPrompt(message: string, history: ChatMessage[], trip?: Pick<TripProfile, "destinationCity" | "dates" | "budget" | "dietaryRules" | "mobilityAndLuggage" | "languagePreferences" | "itinerary">) {
  const tripContext = trip
    ? [
        `Destination: ${trip.destinationCity}`,
        `Dates: ${trip.dates}`,
        `Budget: ${trip.budget}`,
        `Diet: ${trip.dietaryRules}`,
        `Mobility/luggage: ${trip.mobilityAndLuggage}`,
        `Languages: ${trip.languagePreferences}`,
        `Itinerary: ${trip.itinerary}`,
      ].join("\n")
    : "No saved trip is selected.";
  const priorMessages = history.length
    ? history.map((entry) => `${entry.role === "user" ? "Traveler" : "Magellan"}: ${entry.content}`).join("\n")
    : "No earlier messages.";

  return [
    "You are Magellan, a concise, thoughtful travel companion in a normal text chat.",
    "Answer directly and naturally in Markdown when useful. This is not a Live camera session: never ask to turn on the camera or imply that you are seeing the traveler.",
    "Use saved trip constraints only when they are relevant. Do not invent live GPS, current weather, prices, opening hours, or visual facts.",
    "Saved trip context:",
    tripContext,
    "Conversation so far:",
    priorMessages,
    "Traveler's new message:",
    message,
  ].join("\n\n");
}

function normalizeHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const candidate = entry as Record<string, unknown>;
      const content = cleanText(candidate.content, 2_000);
      return (candidate.role === "user" || candidate.role === "assistant") && content
        ? { role: candidate.role, content }
        : undefined;
    })
    .filter((entry): entry is ChatMessage => Boolean(entry))
    .slice(-12);
}

function normalizeTrip(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const trip = value as Partial<TripProfile>;
  const destinationCity = cleanText(trip.destinationCity, 180);
  if (!destinationCity) return undefined;
  return {
    destinationCity,
    dates: cleanText(trip.dates, 240),
    budget: cleanText(trip.budget, 600),
    dietaryRules: cleanText(trip.dietaryRules, 600),
    mobilityAndLuggage: cleanText(trip.mobilityAndLuggage, 600),
    languagePreferences: cleanText(trip.languagePreferences, 360),
    itinerary: cleanText(trip.itinerary, 1_000),
  };
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}
