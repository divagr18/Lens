import { runGeminiLiveTurn } from "@/lib/gemini-live";
import { queryTripContext } from "@/lib/supermemory";
import { LiveTurnRequest } from "@/lib/travel-types";

export async function POST(request: Request) {
  const body = (await request.json()) as LiveTurnRequest;
  const memory = await queryTripContext(
    { id: body.tripId, userId: body.userId },
    body.question
  );
  const observation = await runGeminiLiveTurn(body, memory);

  return Response.json({ observation, memory });
}
