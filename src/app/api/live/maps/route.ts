import {
  computeRoute,
  findPlaceByText,
  searchNearby,
  searchPlacesByText,
} from "@/lib/google-maps";
import { GeoPoint, TravelMode } from "@/lib/travel-types";

type PhoneLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: "locate_me" | "get_directions" | "search_places";
    location?: PhoneLocation;
    destination?: string;
    query?: string;
    travelMode?: TravelMode;
  };
  const origin = locationToPoint(body.location);
  if (body.action !== "search_places" && !origin) {
    return Response.json(
      { error: "Phone location is unavailable. Ask the traveler to allow location access, then try again." },
      { status: 400 }
    );
  }

  if (body.action === "search_places") {
    const errors: string[] = [];
    const places = await searchPlacesByText(body.query ?? "", origin, errors);
    if (errors.length && places.length === 0) {
      return Response.json({ error: errors.join(" ") }, { status: 502 });
    }
    return Response.json({
      places: places.slice(0, 5).map(placeSummary),
      errors,
    });
  }

  if (body.action === "locate_me") {
    const errors: string[] = [];
    const places = await searchNearby(origin!, errors);
    if (errors.length && places.length === 0) {
      return Response.json({ error: errors.join(" ") }, { status: 502 });
    }
    return Response.json({
      location: { accuracyMeters: body.location?.accuracy ?? null },
      nearbyPlaces: places.slice(0, 5).map(placeSummary),
      errors,
    });
  }

  if (body.action === "get_directions") {
    const errors: string[] = [];
    const destination = await findPlaceByText(body.destination ?? "", origin!, errors);
    if (!destination?.location) {
      return Response.json({ error: errors.join(" ") || "Destination was not found." }, { status: 404 });
    }
    const route = await computeRoute(
      { origin: origin!, destination: destination.location, travelMode: body.travelMode ?? "TRANSIT" },
      errors
    );
    if (route.status === "error" || route.status === "missing-api-key") {
      return Response.json(
        { error: [...route.warnings, ...errors].join(" ") || "Route lookup failed." },
        { status: 502 }
      );
    }
    return Response.json({
      destination: placeSummary(destination),
      route: {
        travelMode: route.travelMode,
        duration: route.durationText,
        distance: route.distanceText,
        nextStep: route.nextStep,
        steps: route.steps.slice(0, 5),
        warnings: [...route.warnings, ...errors],
      },
    });
  }

  return Response.json({ error: "Unsupported Maps Live tool action." }, { status: 400 });
}

function locationToPoint(location?: PhoneLocation): GeoPoint | undefined {
  if (
    !location ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng) ||
    Math.abs(location.lat) > 90 ||
    Math.abs(location.lng) > 180
  ) {
    return undefined;
  }
  return { lat: location.lat, lng: location.lng, label: "Current phone location" };
}

function placeSummary(place: {
  id: string;
  displayName: string;
  formattedAddress?: string;
  types: string[];
}) {
  return {
    id: place.id,
    name: place.displayName,
    address: place.formattedAddress ?? null,
    types: place.types.slice(0, 4),
  };
}
