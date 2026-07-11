import { validateCityGameAttempt } from "@/lib/city-games";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { gameId?: string; targetId?: string; imageDataUrl?: string };
    if (typeof body.gameId !== "string" || typeof body.targetId !== "string" || typeof body.imageDataUrl !== "string") {
      return Response.json({ error: "A game, target, and captured image are required." }, { status: 400 });
    }
    return Response.json(
      await validateCityGameAttempt({
        gameId: body.gameId,
        targetId: body.targetId,
        imageDataUrl: body.imageDataUrl,
      })
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not validate this game photo." },
      { status: 502 }
    );
  }
}
