import { createHistoricalVideo } from "@/lib/historical-video";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { topic?: unknown; context?: unknown };
    if (typeof body.topic !== "string") {
      return Response.json({ error: "A historical topic is required." }, { status: 400 });
    }
    return Response.json(
      await createHistoricalVideo({
        topic: body.topic,
        context: typeof body.context === "string" ? body.context : undefined,
      })
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Historical video generation failed." },
      { status: 502 }
    );
  }
}
