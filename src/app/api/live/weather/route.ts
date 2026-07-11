import { findPlaceByText } from "@/lib/google-maps";
import { GeoPoint } from "@/lib/travel-types";
import { getWeatherForecast } from "@/lib/weather";

type PhoneLocation = { lat: number; lng: number; accuracy?: number };

export async function POST(request: Request) {
  const body = (await request.json()) as {
    location?: PhoneLocation;
    locationQuery?: string;
  };
  let location = toGeoPoint(body.location, "Current phone location");

  if (body.locationQuery?.trim()) {
    const errors: string[] = [];
    const place = await findPlaceByText(body.locationQuery, location, errors);
    if (!place?.location) {
      return Response.json(
        { error: errors.join(" ") || `Could not resolve weather location “${body.locationQuery}”.` },
        { status: 404 }
      );
    }
    location = place.location;
  }

  if (!location) {
    return Response.json(
      { error: "Phone location is unavailable. Allow location access or name a weather location." },
      { status: 400 }
    );
  }

  try {
    return Response.json(await getWeatherForecast(location));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Weather forecast lookup failed." },
      { status: 502 }
    );
  }
}

function toGeoPoint(location?: PhoneLocation, label?: string): GeoPoint | undefined {
  if (
    !location ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng) ||
    Math.abs(location.lat) > 90 ||
    Math.abs(location.lng) > 180
  ) {
    return undefined;
  }
  return { lat: location.lat, lng: location.lng, label: label ?? "Weather location" };
}
