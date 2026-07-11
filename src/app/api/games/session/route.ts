import { createCityGame } from "@/lib/city-games";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
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
