import {
  AddMemoryInput,
  MemoryContext,
  TripProfile,
  tripContainerTags,
} from "@/lib/travel-types";

const SUPERMEMORY_BASE_URL = "https://api.supermemory.ai";

type SupermemoryProfileResponse = {
  profile?: {
    static?: string[];
    dynamic?: string[];
  };
  searchResults?: {
    results?: Array<{
      memory?: string;
      chunks?: Array<{ content?: string }>;
    }>;
  };
};

function supermemoryHeaders() {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  if (!apiKey) return null;
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function unavailableContext(
  message: string,
  trip: Pick<TripProfile, "id" | "userId">,
  q: string
): MemoryContext {
  return {
    available: false,
    status: "missing-api-key",
    query: q,
    containerTags: tripContainerTags(trip),
    profileStatic: [],
    profileDynamic: [],
    memories: [],
    message,
  };
}

export async function addTripToMemory(trip: TripProfile) {
  const content = [
    `Destination: ${trip.destinationCity}`,
    `Dates: ${trip.dates}`,
    `Hotel: ${trip.hotel}`,
    `Budget: ${trip.budget}`,
    `Dietary rules: ${trip.dietaryRules}`,
    `Mobility and luggage: ${trip.mobilityAndLuggage}`,
    `Language preferences: ${trip.languagePreferences}`,
    `Itinerary: ${trip.itinerary}`,
  ].join("\n");

  return addMemoryToTrip(trip, {
    content,
    source: "user-entered",
    tags: ["constraint", "booking", "place", "food", "route"],
  });
}

export async function addMemoryToTrip(trip: TripProfile, input: AddMemoryInput) {
  const headers = supermemoryHeaders();
  if (!headers) {
    return {
      available: false,
      status: "missing-api-key" as const,
      message:
        "SUPERMEMORY_API_KEY is not set. Memory was not persisted to Supermemory.",
    };
  }

  const tags = [...tripContainerTags(trip), ...(input.tags ?? [])];
  const res = await fetch(`${SUPERMEMORY_BASE_URL}/v3/documents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customId: `${trip.id}-${input.source}-${Date.now()}`,
      content: input.content,
      metadata: {
        source: input.source,
        destinationCity: trip.destinationCity,
        tripId: trip.id,
      },
      containerTags: tags,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      available: false,
      status: "error" as const,
      message: `Supermemory ingest failed: ${text || res.statusText}`,
    };
  }

  const data = (await res.json()) as { id?: string };
  return {
    available: true,
    status: "ready" as const,
    message: `Queued in Supermemory${data.id ? ` as ${data.id}` : ""}.`,
  };
}

export async function queryTripContext(
  trip: Pick<TripProfile, "id" | "userId">,
  q: string
): Promise<MemoryContext> {
  const headers = supermemoryHeaders();
  if (!headers) {
    return unavailableContext(
      "SUPERMEMORY_API_KEY is not set. Answers will show memory as unavailable.",
      trip,
      q
    );
  }

  const res = await fetch(`${SUPERMEMORY_BASE_URL}/v4/profile`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      containerTag: `trip:${trip.id}`,
      q,
      threshold: 0.55,
      include: ["static", "dynamic"],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      available: false,
      status: "error",
      query: q,
      containerTags: tripContainerTags(trip),
      profileStatic: [],
      profileDynamic: [],
      memories: [],
      message: `Supermemory query failed: ${text || res.statusText}`,
    };
  }

  const data = (await res.json()) as SupermemoryProfileResponse;
  const memories =
    data.searchResults?.results?.flatMap((result) => {
      if (result.memory) return [result.memory];
      return result.chunks?.map((chunk) => chunk.content ?? "").filter(Boolean) ?? [];
    }) ?? [];

  return {
    available: true,
    status: "ready",
    query: q,
    containerTags: tripContainerTags(trip),
    profileStatic: data.profile?.static ?? [],
    profileDynamic: data.profile?.dynamic ?? [],
    memories,
    message: "Supermemory context retrieved.",
  };
}
