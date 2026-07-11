export type ArtifactType =
  | "phrase_card"
  | "route_card"
  | "menu_explainer"
  | "booking_summary"
  | "etiquette_note"
  | "alert";

export type MemorySource =
  | "user-entered"
  | "uploaded-document"
  | "video-derived"
  | "assistant-derived"
  | "correction";

export type RuntimeStatus =
  | "ready"
  | "missing-api-key"
  | "working"
  | "fixture"
  | "disabled"
  | "not-configured"
  | "error";

export type TravelMode = "TRANSIT" | "WALK";

export type GeoPoint = {
  lat: number;
  lng: number;
  label: string;
};

export type LocationPreset = GeoPoint & {
  id: string;
  kind:
    | "metro"
    | "park"
    | "station"
    | "street"
    | "palace"
    | "airport"
    | "hotel";
};

export type RouteStep = {
  instruction: string;
  distanceText?: string;
  durationText?: string;
  travelMode?: string;
  transit?: {
    lineName?: string;
    headsign?: string;
    vehicleType?: string;
    departureStop?: string;
    arrivalStop?: string;
  };
};

export type RouteContext = {
  origin: GeoPoint;
  destination: GeoPoint;
  requestedTravelMode: TravelMode;
  travelMode: TravelMode;
  durationText: string;
  distanceText: string;
  nextStep: string;
  steps: RouteStep[];
  status: RuntimeStatus;
  source: "google-routes" | "fixture" | "disabled" | "error";
  usedFallback: boolean;
  warnings: string[];
};

export type NearbyPlace = {
  id: string;
  displayName: string;
  types: string[];
  formattedAddress?: string;
  location?: GeoPoint;
  googleMapsUrl?: string;
};

export type MapsEvidence = {
  status: RuntimeStatus;
  source: "google-maps" | "fixture" | "disabled" | "error";
  routeQuery: string;
  routeFieldMask: string;
  nearbyQuery: string;
  errors: string[];
};

export type MapsContext = {
  route: RouteContext;
  nearbyPlaces: NearbyPlace[];
  evidence: MapsEvidence;
};

export type TripProfile = {
  id: string;
  userId: string;
  destinationCity: string;
  dates: string;
  hotel: string;
  budget: string;
  dietaryRules: string;
  mobilityAndLuggage: string;
  languagePreferences: string;
  itinerary: string;
};

export type MemoryContext = {
  available: boolean;
  status: RuntimeStatus;
  query: string;
  containerTags: string[];
  profileStatic: string[];
  profileDynamic: string[];
  memories: string[];
  message: string;
};

export type TravelArtifact = {
  id: string;
  type: ArtifactType;
  title: string;
  body: string;
  status: RuntimeStatus;
  runtime:
    | "gemini-omni-flash"
    | "gemini-3.5-flash"
    | "omni-disabled"
  media?: {
    kind: "video";
    mimeType: string;
    dataUrl?: string;
    uri?: string;
    model: string;
    interactionId?: string;
  };
  createdAt: string;
};

export type LiveObservation = {
  id: string;
  tripId: string;
  timestamp: number;
  framePreview?: string;
  userUtterance: string;
  retrievedMemories: string[];
  assistantAnswer: string;
  artifacts: TravelArtifact[];
  status: RuntimeStatus;
  transport: "gemini-live" | "unavailable" | "error";
  createdAt: string;
};

export type AddMemoryInput = {
  content: string;
  source: MemorySource;
  tags?: string[];
};

export type ArtifactRequest = {
  tripId: string;
  type: ArtifactType;
  prompt: string;
  context?: string;
};

export type LiveTurnRequest = {
  type?: "observation";
  tripId: string;
  userId: string;
  question: string;
  timestamp: number;
  frameDataUrl?: string;
  routeContext?: MapsContext;
};

export const defaultTrip: TripProfile = {
  id: "",
  userId: "demo-user",
  destinationCity: "Bengaluru, India",
  dates: "July 12-16",
  hotel: "Indiranagar hotel near Metro access",
  budget: "Keep local transit and food under Rs 2,500 per day.",
  dietaryRules:
    "Vegetarian. Avoid shellfish, fish sauce, meat stock, and shared seafood gravies.",
  mobilityAndLuggage:
    "One carry-on suitcase, prefers metro or app cab over long walks in rain.",
  languagePreferences:
    "English primary, Hindi useful, Kannada phrase cards when helpful.",
  itinerary:
    "Arrive at Kempegowda airport, check in near Indiranagar, visit Cubbon Park, Bengaluru Palace, Church Street, and a local darshini for breakfast.",
};

export function tripContainerTags(trip: Pick<TripProfile, "id" | "userId">) {
  return [`user:${trip.userId}`, `trip:${trip.id}`, "city:india"];
}

export const bengaluruLocationPresets: LocationPreset[] = [
  {
    id: "indiranagar-metro",
    label: "Indiranagar Metro",
    lat: 12.9784,
    lng: 77.6386,
    kind: "metro",
  },
  {
    id: "cubbon-park",
    label: "Cubbon Park",
    lat: 12.9763,
    lng: 77.5929,
    kind: "park",
  },
  {
    id: "majestic",
    label: "Majestic / Kempegowda Bus Station",
    lat: 12.9767,
    lng: 77.5713,
    kind: "station",
  },
  {
    id: "church-street",
    label: "Church Street",
    lat: 12.9744,
    lng: 77.6068,
    kind: "street",
  },
  {
    id: "bengaluru-palace",
    label: "Bengaluru Palace",
    lat: 12.9987,
    lng: 77.5920,
    kind: "palace",
  },
  {
    id: "kempegowda-airport",
    label: "Kempegowda Airport",
    lat: 13.1986,
    lng: 77.7066,
    kind: "airport",
  },
  {
    id: "indiranagar-hotel",
    label: "Indiranagar Hotel Area",
    lat: 12.9719,
    lng: 77.6412,
    kind: "hotel",
  },
];
