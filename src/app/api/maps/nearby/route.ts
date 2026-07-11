import { searchNearby } from "@/lib/google-maps";
import { GeoPoint } from "@/lib/travel-types";

export async function POST(request: Request) {
  const body = (await request.json()) as { origin: GeoPoint };
  const errors: string[] = [];
  const nearbyPlaces = await searchNearby(body.origin, errors);

  return Response.json({ nearbyPlaces, errors });
}
