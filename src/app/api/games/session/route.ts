import { createCityGame } from "@/lib/city-games";
import { hasValidLiveTestToken, liveTestUnauthorizedResponse } from "@/lib/live-test-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!hasValidLiveTestToken(request)) return liveTestUnauthorizedResponse();
  try {
    const body = (await request.json()) as { city?: string };
    if (typeof body.city !== "string") {
      return Response.json({ error: "A city is required to start a game." }, { status: 400 });
    }
    return Response.json({ game: await createCityGame(body.city) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create a city game." },
      { status: 502 }
    );
  }
}
