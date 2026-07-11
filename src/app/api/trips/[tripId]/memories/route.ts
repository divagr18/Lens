import { addMemoryToTrip } from "@/lib/supermemory";
import { AddMemoryInput, TripProfile } from "@/lib/travel-types";

type MemoryRouteContext = {
  params: Promise<{ tripId: string }>;
};

export async function POST(request: Request, context: MemoryRouteContext) {
  const { tripId } = await context.params;
  const body = (await request.json()) as AddMemoryInput & {
    trip: Omit<TripProfile, "id">;
  };

  const memory = await addMemoryToTrip(
    { ...body.trip, id: tripId },
    {
      content: body.content,
      source: body.source,
      tags: body.tags,
    }
  );

  return Response.json(
    { memory },
    { status: memory.status === "error" ? 502 : 200 }
  );
}
