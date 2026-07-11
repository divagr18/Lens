import { GoogleGenAI } from "@google/genai";

const supermemoryBaseUrl = "https://api.supermemory.ai";
const maxUpdatesPerTurn = 4;

const curatorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    updates: {
      type: "array",
      maxItems: maxUpdatesPerTurn,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          scope: { type: "string", enum: ["trip", "profile"] },
          key: { type: "string" },
          fact: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
            maxItems: 4,
          },
        },
        required: ["scope", "key", "fact", "tags"],
      },
    },
  },
  required: ["updates"],
};

export function normalizeLiveTrip(value) {
  if (!value || typeof value !== "object") return undefined;
  const trip = value;
  if (!isSafeId(trip.id) || !isSafeId(trip.userId)) return undefined;
  return {
    id: trip.id,
    userId: trip.userId,
    destinationCity: cleanText(trip.destinationCity, 200),
    dates: cleanText(trip.dates, 160),
    hotel: cleanText(trip.hotel, 300),
    budget: cleanText(trip.budget, 400),
    dietaryRules: cleanText(trip.dietaryRules, 500),
    mobilityAndLuggage: cleanText(trip.mobilityAndLuggage, 500),
    languagePreferences: cleanText(trip.languagePreferences, 300),
    itinerary: cleanText(trip.itinerary, 1_200),
  };
}

export function summarizeTripMemory(trip) {
  if (!trip) return "No saved trip selected for this Live session.";
  return [
    `Destination: ${trip.destinationCity || "not specified"}`,
    `Dates: ${trip.dates || "not specified"}`,
    `Hotel: ${trip.hotel || "not specified"}`,
    `Budget: ${trip.budget || "not specified"}`,
    `Dietary rules: ${trip.dietaryRules || "not specified"}`,
    `Mobility and luggage: ${trip.mobilityAndLuggage || "not specified"}`,
    `Language preferences: ${trip.languagePreferences || "not specified"}`,
    `Itinerary: ${trip.itinerary || "not specified"}`,
  ].join("\n");
}

export async function loadTravelMemory(trip, query = "current traveler preferences, trip constraints, plans, and corrections") {
  const headers = supermemoryHeaders();
  if (!headers) return { ok: false, text: "", message: "SUPERMEMORY_API_KEY is not configured." };

  const [profile, tripContext] = await Promise.all([
    fetchMemoryContext(`user:${trip.userId}`, query, headers),
    fetchMemoryContext(`trip:${trip.id}`, query, headers),
  ]);

  const parts = [
    profile.ok && profile.text ? `Reusable traveler profile:\n${profile.text}` : "",
    tripContext.ok && tripContext.text ? `Current trip memory:\n${tripContext.text}` : "",
  ].filter(Boolean);

  if (!parts.length) {
    return {
      ok: false,
      text: "",
      message: profile.message || tripContext.message || "No saved Supermemory context is available yet.",
    };
  }
  return { ok: true, text: parts.join("\n\n").slice(0, 6_000), message: "Memory context loaded." };
}

export async function curateTranscriptTurn({ trip, userText, assistantText }) {
  if (!process.env.GEMINI_API_KEY) {
    return { status: "error", message: "GEMINI_API_KEY is not configured.", updates: [] };
  }
  if (!process.env.SUPERMEMORY_API_KEY) {
    return { status: "error", message: "SUPERMEMORY_API_KEY is not configured.", updates: [] };
  }
  if (!userText.trim() || !assistantText.trim()) {
    return { status: "skipped", message: "No complete traveler-and-assistant turn to curate.", updates: [] };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MEMORY_MODEL || "gemini-3.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You curate durable travel memory from one completed conversation turn.",
              "Return updates only for facts the traveler explicitly stated, confirmed, corrected, or clearly chose.",
              "Keep profile scope for reusable preferences and long-term constraints. Keep trip scope for dates, bookings, destinations, itinerary decisions, and temporary trip facts.",
              "Never store small talk, raw location coordinates, camera observations, model suggestions, tool results, guesses, or any fact stated only by the assistant.",
              "Use a stable lowercase kebab-case key naming the memory slot, such as dietary-preference, walking-limit, hotel, or train-booking.",
              "If nothing is durable, return an empty updates array.",
              "",
              `Traveler: ${userText.slice(0, 4_000)}`,
              `Assistant: ${assistantText.slice(0, 4_000)}`,
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: curatorSchema,
    },
  });

  const updates = parseMemoryUpdates(response.text);
  if (!updates.length) return { status: "skipped", message: "No durable memory found in this turn.", updates: [] };

  const results = await Promise.all(updates.map((update) => upsertCuratedMemory(trip, update)));
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    return { status: "error", message: failures[0].message, updates: [] };
  }
  return { status: "saved", message: `${updates.length} memory update${updates.length === 1 ? "" : "s"} saved.`, updates };
}

export function parseMemoryUpdates(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data?.updates)) return [];
    const seen = new Set();
    return data.updates
      .map((update) => normalizeMemoryUpdate(update))
      .filter((update) => {
        if (!update) return false;
        const identity = `${update.scope}:${update.key}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
      .slice(0, maxUpdatesPerTurn);
  } catch {
    return [];
  }
}

export function curatedMemoryCustomId(trip, update) {
  const owner = update.scope === "profile" ? trip.userId : trip.id;
  const safeKey = update.key.slice(0, 64);
  return `lens-curated:${update.scope}:${owner}:${safeKey}`;
}

async function upsertCuratedMemory(trip, update) {
  const headers = supermemoryHeaders();
  if (!headers) return { ok: false, message: "SUPERMEMORY_API_KEY is not configured." };
  const containerTags = update.scope === "profile"
    ? [`user:${trip.userId}`]
    : [`user:${trip.userId}`, `trip:${trip.id}`];
  const response = await fetch(`${supermemoryBaseUrl}/v3/documents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customId: curatedMemoryCustomId(trip, update),
      content: update.fact,
      containerTags,
      metadata: {
        source: "assistant-derived",
        scope: update.scope,
        memoryKey: update.key,
        tripId: trip.id,
        userId: trip.userId,
        tags: update.tags.join(","),
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    return { ok: false, message: `Supermemory ingest failed: ${text || response.statusText}` };
  }
  return { ok: true };
}

async function fetchMemoryContext(containerTag, query, headers) {
  try {
    const response = await fetch(`${supermemoryBaseUrl}/v4/profile`, {
      method: "POST",
      headers,
      body: JSON.stringify({ containerTag, q: query, threshold: 0.55, include: ["static", "dynamic"] }),
    });
    if (!response.ok) return { ok: false, text: "", message: await response.text() };
    const data = await response.json();
    const text = [
      ...(data.profile?.static ?? []),
      ...(data.profile?.dynamic ?? []),
      ...(data.searchResults?.results ?? []).flatMap((result) => result.memory ? [result.memory] : result.chunks?.map((chunk) => chunk.content).filter(Boolean) ?? []),
    ].join("\n");
    return { ok: true, text: text.slice(0, 3_000), message: "" };
  } catch (error) {
    return { ok: false, text: "", message: error instanceof Error ? error.message : "Memory lookup failed." };
  }
}

function normalizeMemoryUpdate(value) {
  if (!value || typeof value !== "object") return undefined;
  const scope = value.scope === "trip" || value.scope === "profile" ? value.scope : undefined;
  const key = typeof value.key === "string" ? value.key.trim().toLowerCase() : "";
  const fact = cleanText(value.fact, 700);
  if (!scope || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || !fact) return undefined;
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag) => typeof tag === "string" && /^[a-z0-9-]{1,32}$/i.test(tag)).slice(0, 4)
    : [];
  return { scope, key, fact, tags };
}

function supermemoryHeaders() {
  if (!process.env.SUPERMEMORY_API_KEY) return undefined;
  return { Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`, "Content-Type": "application/json" };
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function isSafeId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}
