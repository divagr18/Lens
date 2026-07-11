import { getMapsContext } from "@/lib/google-maps";
import { GeoPoint, TravelMode } from "@/lib/travel-types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    origin: GeoPoint;
    destination: GeoPoint;
    travelMode?: TravelMode;
  };
  const mapsContext = await getMapsContext(body);

  return Response.json({ mapsContext });
}
