import {
  GeoPoint,
  MapsContext,
  NearbyPlace,
  RouteContext,
  RouteStep,
  TravelMode,
} from "@/lib/travel-types";
import { GoogleAuth } from "google-auth-library";
import { randomUUID } from "node:crypto";

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const ROUTE_FIELD_MASK =
  "routes.duration,routes.distanceMeters,routes.localizedValues,routes.legs.steps";
const NEARBY_FIELD_MASK =
  "places.id,places.displayName,places.types,places.formattedAddress,places.location,places.googleMapsUri";
const TEXT_SEARCH_FIELD_MASK = NEARBY_FIELD_MASK;
const NEARBY_TYPES = [
  "subway_station",
  "train_station",
  "bus_station",
  "restaurant",
  "cafe",
  "tourist_attraction",
  "lodging",
  "atm",
];
const DEFAULT_MAPS_OAUTH_SCOPES = ["https://www.googleapis.com/auth/maps-platform"];

type MapsContextRequest = {
  origin: GeoPoint;
  destination: GeoPoint;
  travelMode?: TravelMode;
};

type MapsAuth =
  | {
      headers: Record<string, string>;
      mode: "api-key" | "oauth";
    }
  | {
      error: string;
    };

type GoogleRouteResponse = {
  routes?: Array<{
    duration?: string;
    distanceMeters?: number;
    localizedValues?: {
      duration?: { text?: string };
      distance?: { text?: string };
    };
    legs?: Array<{
      steps?: Array<{
        distanceMeters?: number;
        staticDuration?: string;
        localizedValues?: {
          duration?: { text?: string };
          distance?: { text?: string };
        };
        travelMode?: string;
        navigationInstruction?: { instructions?: string };
        transitDetails?: {
          stopDetails?: {
            departureStop?: { name?: string };
            arrivalStop?: { name?: string };
          };
          localizedValues?: {
            transitFare?: { text?: string };
          };
          transitLine?: {
            name?: string;
            nameShort?: string;
            vehicle?: { type?: string; name?: { text?: string } };
          };
          headsign?: string;
        };
      }>;
    }>;
  }>;
};

type GoogleNearbyResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    types?: string[];
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    googleMapsUri?: string;
  }>;
};

function mapsApiKey() {
  return envValue("GOOGLE_MAPS_API_KEY");
}

function mapsAuthMode() {
  const mode = envValue("GOOGLE_MAPS_AUTH_MODE");
  return mode === "oauth" || mode === "api-key" ? mode : "auto";
}

function mapsOAuthToken() {
  return envValue("GOOGLE_MAPS_OAUTH_TOKEN");
}

function languageCode() {
  return process.env.MAPS_DEFAULT_LANGUAGE || "en-IN";
}

function units() {
  return process.env.MAPS_DEFAULT_UNITS || "METRIC";
}

function fixtureMode() {
  return process.env.MAPS_FIXTURE_MODE === "true";
}

export async function getMapsContext(
  request: MapsContextRequest
): Promise<MapsContext> {
  if (fixtureMode()) {
    return fixtureMapsContext(request);
  }

  const auth = await mapsAuth();
  if ("error" in auth) {
    return disabledMapsContext(request);
  }

  const errors: string[] = [];
  const route = await computeRoute(request, errors, auth);
  const nearbyPlaces = await searchNearby(request.origin, errors, auth);

  return {
    route,
    nearbyPlaces,
    evidence: {
      status: errors.length ? "error" : "ready",
      source: errors.length ? "error" : "google-maps",
      routeQuery: `${request.origin.label} -> ${request.destination.label}`,
      routeFieldMask: ROUTE_FIELD_MASK,
      nearbyQuery: `${request.origin.label}, ${NEARBY_TYPES.join(", ")}`,
      errors,
    },
  };
}

export async function computeRoute(
  request: MapsContextRequest,
  errors: string[] = [],
  providedAuth?: Extract<MapsAuth, { headers: Record<string, string> }>
): Promise<RouteContext> {
  if (fixtureMode()) {
    return fixtureMapsContext(request).route;
  }

  const auth = providedAuth ?? (await mapsAuth());
  if ("error" in auth) {
    return disabledRoute(request);
  }

  const transit = await requestRoute(request, "TRANSIT", auth);
  if (transit.route) {
    return transit.route;
  }
  const transitError = transit.error;

  const walking = await requestRoute(request, "WALK", auth);
  if (walking.route) {
    return {
      ...walking.route,
      requestedTravelMode: "TRANSIT",
      usedFallback: true,
      warnings: [
        `Transit route was unavailable${
          transitError ? `: ${transitError}` : ""
        }. Walking directions are shown.`,
        ...walking.route.warnings,
      ],
    };
  }
  if (transitError) {
    errors.push(`TRANSIT route failed: ${transitError}`);
  }
  if (walking.error) {
    errors.push(`WALK route failed: ${walking.error}`);
  }

  return errorRoute(request, errors.join(" ") || "No usable route returned.");
}

export async function searchNearby(
  origin: GeoPoint,
  errors: string[] = [],
  providedAuth?: Extract<MapsAuth, { headers: Record<string, string> }>
): Promise<NearbyPlace[]> {
  if (fixtureMode()) {
    return fixtureNearby(origin);
  }

  const auth = providedAuth ?? (await mapsAuth());
  if ("error" in auth) {
    return [];
  }

  try {
    const res = await fetch(NEARBY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": NEARBY_FIELD_MASK,
        ...auth.headers,
      },
      body: JSON.stringify({
        includedTypes: NEARBY_TYPES,
        maxResultCount: 10,
        rankPreference: "DISTANCE",
        languageCode: languageCode(),
        locationRestriction: {
          circle: {
            center: {
              latitude: origin.lat,
              longitude: origin.lng,
            },
            radius: 1000,
          },
        },
      }),
    });

    if (!res.ok) {
      errors.push(await responseMessage(res, auth.mode));
      return [];
    }

    const data = (await res.json()) as GoogleNearbyResponse;
    return (data.places ?? []).map(toNearbyPlace);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Nearby search failed.");
    return [];
  }
}

export async function findPlaceByText(
  query: string,
  origin?: GeoPoint,
  errors: string[] = [],
  providedAuth?: Extract<MapsAuth, { headers: Record<string, string> }>
): Promise<NearbyPlace | undefined> {
  return (await searchPlacesByText(query, origin, errors, providedAuth))[0];
}

export async function searchPlacesByText(
  query: string,
  origin?: GeoPoint,
  errors: string[] = [],
  providedAuth?: Extract<MapsAuth, { headers: Record<string, string> }>
): Promise<NearbyPlace[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    errors.push("A destination name is required.");
    return [];
  }
  if (fixtureMode()) {
    return [
      {
        id: "fixture-destination",
        displayName: normalizedQuery,
        types: ["point_of_interest"],
        formattedAddress: "Fixture destination for Bengaluru testing",
        location: origin
          ? { lat: origin.lat + 0.01, lng: origin.lng + 0.01, label: normalizedQuery }
          : undefined,
      },
    ];
  }

  const auth = providedAuth ?? (await mapsAuth());
  if ("error" in auth) {
    errors.push(auth.error);
    return [];
  }

  try {
    const res = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": TEXT_SEARCH_FIELD_MASK,
        ...auth.headers,
      },
      body: JSON.stringify({
        textQuery: normalizedQuery,
        languageCode: languageCode(),
        ...(origin
          ? {
              locationBias: {
                circle: {
                  center: { latitude: origin.lat, longitude: origin.lng },
                  radius: 50_000,
                },
              },
            }
          : {}),
      }),
    });
    if (!res.ok) {
      errors.push(await responseMessage(res, auth.mode));
      return [];
    }

    const places = ((await res.json()) as GoogleNearbyResponse).places ?? [];
    if (!places.length) {
      errors.push(`No place matched “${normalizedQuery}”.`);
      return [];
    }
    return places.map(toNearbyPlace);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Place text search failed.");
    return [];
  }
}

async function requestRoute(
  request: MapsContextRequest,
  travelMode: TravelMode,
  auth: Extract<MapsAuth, { headers: Record<string, string> }>
): Promise<{ route?: RouteContext; error?: string }> {
  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": ROUTE_FIELD_MASK,
        ...auth.headers,
      },
      body: JSON.stringify({
        origin: latLngWaypoint(request.origin),
        destination: latLngWaypoint(request.destination),
        travelMode,
        languageCode: languageCode(),
        units: units(),
        computeAlternativeRoutes: false,
      }),
    });

    if (!res.ok) {
      return { error: await responseMessage(res, auth.mode) };
    }

    const data = (await res.json()) as GoogleRouteResponse;
    const route = data.routes?.[0];
    if (!route) {
      return { error: "No route returned." };
    }

    const steps = parseRouteSteps(route);
    return {
      route: {
        origin: request.origin,
        destination: request.destination,
        requestedTravelMode: request.travelMode ?? "TRANSIT",
        travelMode,
        durationText:
          route.localizedValues?.duration?.text || secondsText(route.duration),
        distanceText:
          route.localizedValues?.distance?.text ||
          metersText(route.distanceMeters),
        nextStep: steps[0]?.instruction || "Route found. Review the steps.",
        steps,
        status: "ready",
        source: "google-routes",
        usedFallback: false,
        warnings: [],
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Route request failed.",
    };
  }
}

async function mapsAuth(): Promise<MapsAuth> {
  const mode = mapsAuthMode();
  const apiKey = mapsApiKey();

  if (mode !== "oauth" && apiKey) {
    return {
      headers: { "X-Goog-Api-Key": apiKey },
      mode: "api-key",
    };
  }

  if (mode !== "api-key") {
    try {
      const token = await resolveMapsOAuthToken();
      if (token) {
        return {
          headers: { Authorization: `Bearer ${token}` },
          mode: "oauth",
        };
      }
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Google Maps OAuth token could not be resolved.",
      };
    }
  }

  return {
    error:
      "No usable Google Maps credential found. Set GOOGLE_MAPS_API_KEY, or set GOOGLE_MAPS_AUTH_MODE=oauth with GOOGLE_MAPS_OAUTH_TOKEN or GOOGLE_APPLICATION_CREDENTIALS.",
  };
}

async function resolveMapsOAuthToken() {
  const explicitToken = mapsOAuthToken();
  if (explicitToken) return explicitToken;

  const credentialsJson = envValue("GOOGLE_MAPS_SERVICE_ACCOUNT_JSON");
  const scopes =
    envValue("GOOGLE_MAPS_OAUTH_SCOPES")
      ?.split(",")
      .map((scope) => scope.trim())
      .filter(Boolean) ?? DEFAULT_MAPS_OAUTH_SCOPES;
  const auth = new GoogleAuth({
    credentials: credentialsJson ? JSON.parse(credentialsJson) : undefined,
    scopes,
  });

  return auth.getAccessToken();
}

function latLngWaypoint(point: GeoPoint) {
  return {
    location: {
      latLng: {
        latitude: point.lat,
        longitude: point.lng,
      },
    },
  };
}

function parseRouteSteps(route: NonNullable<GoogleRouteResponse["routes"]>[number]) {
  const steps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  return steps.slice(0, 8).map<RouteStep>((step) => {
    const line = step.transitDetails?.transitLine;
    const vehicleName = line?.vehicle?.name?.text || line?.vehicle?.type;
    const instruction =
      step.navigationInstruction?.instructions ||
      [step.travelMode, line?.nameShort || line?.name, vehicleName]
        .filter(Boolean)
        .join(" ") ||
      "Continue";

    return {
      instruction,
      distanceText:
        step.localizedValues?.distance?.text || metersText(step.distanceMeters),
      durationText:
        step.localizedValues?.duration?.text || secondsText(step.staticDuration),
      travelMode: step.travelMode,
      transit: step.transitDetails
        ? {
            lineName: line?.nameShort || line?.name,
            headsign: step.transitDetails.headsign,
            vehicleType: vehicleName,
            departureStop: step.transitDetails.stopDetails?.departureStop?.name,
            arrivalStop: step.transitDetails.stopDetails?.arrivalStop?.name,
          }
        : undefined,
    };
  });
}

function disabledMapsContext(request: MapsContextRequest): MapsContext {
  return {
    route: disabledRoute(request),
    nearbyPlaces: [],
    evidence: {
      status: "missing-api-key",
      source: "disabled",
      routeQuery: `${request.origin.label} -> ${request.destination.label}`,
      routeFieldMask: ROUTE_FIELD_MASK,
      nearbyQuery: `${request.origin.label}, ${NEARBY_TYPES.join(", ")}`,
      errors: [
        "No Google Maps credential is configured. Set GOOGLE_MAPS_API_KEY, or set GOOGLE_MAPS_AUTH_MODE=oauth with GOOGLE_MAPS_OAUTH_TOKEN or GOOGLE_APPLICATION_CREDENTIALS.",
      ],
    },
  };
}

function disabledRoute(request: MapsContextRequest): RouteContext {
  return {
    origin: request.origin,
    destination: request.destination,
    requestedTravelMode: request.travelMode ?? "TRANSIT",
    travelMode: request.travelMode ?? "TRANSIT",
    durationText: "Unavailable",
    distanceText: "Unavailable",
    nextStep:
      "Set GOOGLE_MAPS_API_KEY, configure Google Maps OAuth, or enable MAPS_FIXTURE_MODE=true.",
    steps: [],
    status: "missing-api-key",
    source: "disabled",
    usedFallback: false,
    warnings: ["Maps credential missing."],
  };
}

function errorRoute(request: MapsContextRequest, message: string): RouteContext {
  return {
    origin: request.origin,
    destination: request.destination,
    requestedTravelMode: request.travelMode ?? "TRANSIT",
    travelMode: request.travelMode ?? "TRANSIT",
    durationText: "Unavailable",
    distanceText: "Unavailable",
    nextStep: message,
    steps: [],
    status: "error",
    source: "error",
    usedFallback: false,
    warnings: [message],
  };
}

function fixtureMapsContext(request: MapsContextRequest): MapsContext {
  return {
    route: {
      origin: request.origin,
      destination: request.destination,
      requestedTravelMode: "TRANSIT",
      travelMode: "TRANSIT",
      durationText: "28 min",
      distanceText: "6.2 km",
      nextStep:
        "Walk to Indiranagar Metro, take the Purple Line toward Challaghatta, then exit near Cubbon Park.",
      steps: [
        {
          instruction: "Walk to Indiranagar Metro station entrance.",
          distanceText: "400 m",
          durationText: "6 min",
          travelMode: "WALK",
        },
        {
          instruction: "Take the Purple Line toward Challaghatta.",
          distanceText: "5.1 km",
          durationText: "14 min",
          travelMode: "TRANSIT",
          transit: {
            lineName: "Purple Line",
            headsign: "Challaghatta",
            vehicleType: "Metro",
            departureStop: "Indiranagar",
            arrivalStop: "Cubbon Park",
          },
        },
        {
          instruction: "Exit the station and walk toward the park gate.",
          distanceText: "700 m",
          durationText: "8 min",
          travelMode: "WALK",
        },
      ],
      status: "fixture",
      source: "fixture",
      usedFallback: false,
      warnings: ["Fixture route for Bengaluru PC testing."],
    },
    nearbyPlaces: fixtureNearby(request.origin),
    evidence: {
      status: "fixture",
      source: "fixture",
      routeQuery: `${request.origin.label} -> ${request.destination.label}`,
      routeFieldMask: ROUTE_FIELD_MASK,
      nearbyQuery: `${request.origin.label}, ${NEARBY_TYPES.join(", ")}`,
      errors: [],
    },
  };
}

function fixtureNearby(origin: GeoPoint): NearbyPlace[] {
  return [
    {
      id: "fixture-indiranagar-metro",
      displayName: `${origin.label} transit area`,
      types: ["subway_station", "point_of_interest"],
      formattedAddress: "Fixture result for Bengaluru testing",
      location: origin,
    },
    {
      id: "fixture-vegetarian-cafe",
      displayName: "Vegetarian cafe nearby",
      types: ["restaurant", "cafe"],
      formattedAddress: "Fixture result - verify in real Maps before travel",
      location: {
        lat: origin.lat + 0.002,
        lng: origin.lng + 0.002,
        label: "Vegetarian cafe nearby",
      },
    },
  ];
}

function toNearbyPlace(place: NonNullable<GoogleNearbyResponse["places"]>[number]): NearbyPlace {
  return {
    id: place.id || place.displayName?.text || randomUUID(),
    displayName: place.displayName?.text || "Unnamed place",
    types: place.types ?? [],
    formattedAddress: place.formattedAddress,
    location:
      typeof place.location?.latitude === "number" &&
      typeof place.location.longitude === "number"
        ? {
            lat: place.location.latitude,
            lng: place.location.longitude,
            label: place.displayName?.text || "Nearby place",
          }
        : undefined,
    googleMapsUrl: place.googleMapsUri,
  };
}

function metersText(meters?: number) {
  if (typeof meters !== "number") return "Distance unavailable";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function secondsText(duration?: string) {
  if (!duration) return "Duration unavailable";
  const seconds = Number(duration.replace("s", ""));
  if (!Number.isFinite(seconds)) return "Duration unavailable";
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

async function responseMessage(res: Response, authMode?: "api-key" | "oauth") {
  const text = await res.text();
  let message = text || `${res.status} ${res.statusText}`;
  try {
    const data = JSON.parse(text) as {
      error?: { message?: string; status?: string; details?: unknown[] };
    };
    message = data.error?.message || message;
  } catch {
    // Keep the raw body if Google returns a non-JSON error.
  }

  if (message.includes("API keys are not supported")) {
    return [
      message,
      authMode === "api-key"
        ? "The request used GOOGLE_MAPS_API_KEY. Verify this is a Google Maps Platform server key with Routes API enabled, not a Google AI/Vertex key. You can also set GOOGLE_MAPS_AUTH_MODE=oauth and use a service-account token for server-side Maps calls."
        : "The request used OAuth, but Google still rejected the credential. Verify the service account has access to the Maps Platform project and billing is enabled.",
    ].join(" ");
  }

  return message;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value === "YOUR_API_KEY" || value === "changeme") return undefined;
  return value;
}
