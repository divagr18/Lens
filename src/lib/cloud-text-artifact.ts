import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "node:crypto";
import { ArtifactRequest, TravelArtifact } from "@/lib/travel-types";

export async function createCloudTextArtifact(request: ArtifactRequest): Promise<TravelArtifact> {
  const now = new Date().toISOString();
  if (!process.env.GEMINI_API_KEY) {
    return {
      id: randomUUID(),
      type: request.type,
      title: "Gemini API key missing",
      body: "GEMINI_API_KEY is required to create this cloud travel summary.",
      status: "missing-api-key",
      runtime: "gemini-3.5-flash",
      createdAt: now,
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MEMORY_MODEL || "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Create a concise, practical travel booking summary.",
                "Do not invent confirmation numbers, prices, dates, or policies not supplied in the request.",
                `Request: ${request.prompt}`,
                request.context ? `Trip context: ${request.context}` : "Trip context: none supplied",
              ].join("\n"),
            },
          ],
        },
      ],
    });
    return {
      id: randomUUID(),
      type: request.type,
      title: "Gemini booking summary",
      body: response.text?.trim() || "Gemini returned no booking-summary text.",
      status: response.text?.trim() ? "ready" : "error",
      runtime: "gemini-3.5-flash",
      createdAt: now,
    };
  } catch (error) {
    return {
      id: randomUUID(),
      type: request.type,
      title: "Gemini booking summary failed",
      body: error instanceof Error ? error.message : "Gemini could not create the booking summary.",
      status: "error",
      runtime: "gemini-3.5-flash",
      createdAt: now,
    };
  }
}
