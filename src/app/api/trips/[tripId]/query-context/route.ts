import { queryTripContext } from "@/lib/supermemory";

type QueryContextRouteContext = {
  params: Promise<{ tripId: string }>;
};

export async function POST(request: Request, context: QueryContextRouteContext) {
  const { tripId } = await context.params;
  const body = (await request.json()) as { userId: string; q: string };
  const memory = await queryTripContext(
    { id: tripId, userId: body.userId },
    body.q
  );

  return Response.json({ memory });
}
