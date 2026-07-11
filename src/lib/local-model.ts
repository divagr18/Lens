import { randomUUID } from "node:crypto";
import { ArtifactRequest, TravelArtifact } from "@/lib/travel-types";

export async function createLocalArtifact(
  request: ArtifactRequest
): Promise<TravelArtifact> {
  const enabled = process.env.LOCAL_MODEL_ENABLED === "true";
  const modelPath = process.env.LITERT_MODEL_PATH;
  const now = new Date().toISOString();

  if (!enabled) {
    return {
      id: randomUUID(),
      type: request.type,
      title: "Local Gemma text layer disabled",
      body:
        "Set LOCAL_MODEL_ENABLED=true and LITERT_MODEL_PATH to enable LiteRT-LM text artifact generation. Visual/image/video outputs are handled by Gemini Omni Flash, not Gemma.",
      status: "disabled",
      runtime: "local-disabled",
      createdAt: now,
    };
  }

  if (!modelPath) {
    return {
      id: randomUUID(),
      type: request.type,
      title: "LiteRT-LM model path missing",
      body:
        "LOCAL_MODEL_ENABLED is true, but LITERT_MODEL_PATH is empty. The adapter did not route this text task to Gemini or Omni Flash.",
      status: "not-configured",
      runtime: "local-disabled",
      createdAt: now,
    };
  }

  return {
    id: randomUUID(),
    type: request.type,
    title: artifactTitle(request.type),
    body: [
      `LiteRT-LM adapter target: ${modelPath}`,
      `Prompt: ${request.prompt}`,
      request.context ? `Context: ${request.context}` : "Context: none supplied",
      "Runtime invocation is isolated behind this adapter so a CLI/mobile runtime can be wired without touching UI code.",
    ].join("\n"),
    status: "not-configured",
    runtime: "litert-lm",
    createdAt: now,
  };
}

function artifactTitle(type: ArtifactRequest["type"]) {
  const titles: Record<ArtifactRequest["type"], string> = {
    phrase_card: "Phrase card",
    route_card: "Route card",
    menu_explainer: "Menu explainer",
    booking_summary: "Booking summary",
    etiquette_note: "Etiquette note",
    alert: "Travel alert",
  };
  return titles[type];
}
