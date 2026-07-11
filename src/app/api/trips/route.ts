import { randomUUID } from "node:crypto";
import { addTripToMemory } from "@/lib/supermemory";
import { TripProfile } from "@/lib/travel-types";

export async function POST(request: Request) {
  const body = (await request.json()) as Omit<TripProfile, "id"> & {
    id?: string;
  };
  const trip: TripProfile = {
    id: body.id || randomUUID(),
    userId: body.userId,
    destinationCity: body.destinationCity,
    dates: body.dates,
    hotel: body.hotel,
    budget: body.budget,
    dietaryRules: body.dietaryRules,
    mobilityAndLuggage: body.mobilityAndLuggage,
    languagePreferences: body.languagePreferences,
    itinerary: body.itinerary,
  };

  const memory = await addTripToMemory(trip);
  return Response.json({ trip, memory });
}
