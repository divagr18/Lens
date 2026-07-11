import { hasValidLiveTestToken, liveTestUnauthorizedResponse } from "@/lib/live-test-auth";
import { translateVisual } from "@/lib/visual-translation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!hasValidLiveTestToken(request)) return liveTestUnauthorizedResponse();
  try {
    const body = (await request.json()) as { imageDataUrl?: string; targetLanguage?: string };
    if (typeof body.imageDataUrl !== "string" || typeof body.targetLanguage !== "string") {
      return Response.json({ error: "A captured image and target language are required." }, { status: 400 });
    }
    return Response.json(
      await translateVisual({
        imageDataUrl: body.imageDataUrl,
        targetLanguage: body.targetLanguage,
      })
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Visual translation failed." },
      { status: 502 }
    );
  }
}
