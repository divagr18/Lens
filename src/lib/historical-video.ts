import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "node:crypto";

const maxTopicLength = 500;
const maxContextLength = 1_500;

export type HistoricalVideoResult = {
  id: string;
  status: "ready" | "error";
  title: string;
  summary: string;
  disclaimer: string;
  model: string;
  interactionId?: string;
  videoDataUrl?: string;
  fallbackMessage?: string;
};

export async function createHistoricalVideo({
  topic,
  context,
}: {
  topic: string;
  context?: string;
}): Promise<HistoricalVideoResult> {
  const cleanTopic = cleanText(topic, maxTopicLength);
  const cleanContext = cleanText(context, maxContextLength);
  if (!cleanTopic) throw new Error("Name the historical event, battle, site, or question to visualize.");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured on this laptop.");

  const model = process.env.GEMINI_HISTORICAL_VIDEO_MODEL || "gemini-omni-flash-preview";
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const interaction = await ai.interactions.create({
    model,
    input: buildHistoricalVideoPrompt(cleanTopic, cleanContext),
    response_format: {
      type: "video",
      aspect_ratio: "9:16",
    },
    generation_config: {
      video_config: {
        task: "text_to_video",
      },
    },
  });

  const videoData = interaction.output_video?.data;
  const mimeType = interaction.output_video?.mime_type || "video/mp4";
  const title = `A moment from ${cleanTopic}`.slice(0, 100);
  const disclaimer = "AI-generated illustrative reconstruction — not archival footage or a definitive historical account.";

  if (!videoData) {
    return {
      id: randomUUID(),
      status: "error",
      title,
      summary: "The historical scene could not be rendered.",
      disclaimer,
      model: interaction.model || model,
      interactionId: interaction.id,
      fallbackMessage: describeMissingVideo(interaction),
    };
  }

  return {
    id: randomUUID(),
    status: "ready",
    title,
    summary: "A short visual reconstruction generated from the requested historical context.",
    disclaimer,
    model: interaction.model || model,
    interactionId: interaction.id,
    videoDataUrl: `data:${mimeType};base64,${videoData}`,
  };
}

function buildHistoricalVideoPrompt(topic: string, context: string) {
  return [
    "Create a short vertical historical reconstruction for a travel companion app.",
    `Subject: ${topic}.`,
    context ? `Traveler context: ${context}.` : "Traveler context: the traveler is viewing a historical place and asked for a visual explanation.",
    "The traveler can request this from anywhere. Do not require, depict, or infer that they are currently at a particular monument, city, or GPS location.",
    "Use a respectful museum-documentary style. Show a clear sense of period, terrain, formations, and camera movement that helps explain the event.",
    "Include a calm, concise educational voiceover that explains the high-level historical context and clearly treats the scene as a reconstruction. Do not use captions or subtitles.",
    "This is an illustrative reconstruction, not archival footage. Avoid factual claims in on-screen text and do not invent dates, quotes, named people, uniforms, flags, or tactics when uncertain.",
    "Depict conflict non-graphically: no gore, injuries, corpses, executions, cruelty, or close-up violence. Do not glorify war or portray present-day political groups.",
    "No captions, subtitles, logos, watermarks, modern objects, or UI elements. Keep it visually legible on a phone screen.",
  ].join("\n");
}

function describeMissingVideo(interaction: {
  status?: string;
  output_text?: string;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}) {
  const modelMessage = interaction.steps
    ?.flatMap((step) => step.content ?? [])
    .find((content) => content.type === "text" && content.text)?.text;
  return cleanText(modelMessage, 280) || `Gemini Omni Flash returned no playable video. Status: ${interaction.status || "unknown"}.`;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}
