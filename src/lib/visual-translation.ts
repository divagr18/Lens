import { GoogleGenAI, Modality } from "@google/genai";
import { randomUUID } from "node:crypto";

const maxImageBytes = 3_000_000;
const translationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceLanguage: { type: "string" },
    surfaceType: {
      type: "string",
      enum: ["menu", "sign", "notice", "placard", "timetable", "storefront", "packaging", "other"],
    },
    textBlocks: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string" },
          translation: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["source", "translation", "confidence"],
      },
    },
  },
  required: ["sourceLanguage", "surfaceType", "textBlocks"],
};

export type VisualTextBlock = {
  source: string;
  translation: string;
  confidence: number;
};

export type VisualTranslationResult = {
  id: string;
  status: "ready" | "fallback" | "error";
  sourceLanguage: string;
  targetLanguage: string;
  surfaceType: string;
  textBlocks: VisualTextBlock[];
  editedImageDataUrl?: string;
  fallbackMessage?: string;
};

export async function translateVisual({
  imageDataUrl,
  targetLanguage,
}: {
  imageDataUrl: string;
  targetLanguage: string;
}): Promise<VisualTranslationResult> {
  const image = parseImageDataUrl(imageDataUrl);
  const language = cleanLanguage(targetLanguage);
  if (!image) throw new Error("Capture a JPEG or PNG image under 3 MB first.");
  if (!language) throw new Error("Choose a target language before translating.");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured on this laptop.");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const analysis = await analyzeVisual(ai, image, language);
  const id = randomUUID();

  try {
    const editedImage = await createTranslatedImage(ai, image, language, analysis);
    if (!editedImage) {
      return {
        id,
        status: "fallback",
        targetLanguage: language,
        ...analysis,
        fallbackMessage: "The translated copy was unavailable, so the original image and extracted translation are shown instead.",
      };
    }
    return {
      id,
      status: "ready",
      targetLanguage: language,
      ...analysis,
      editedImageDataUrl: `data:${editedImage.mimeType};base64,${editedImage.data}`,
    };
  } catch (error) {
    return {
      id,
      status: "fallback",
      targetLanguage: language,
      ...analysis,
      fallbackMessage:
        error instanceof Error
          ? `The translated copy could not be rendered: ${error.message}`
          : "The translated copy could not be rendered. The extracted translation is still available.",
    };
  }
}

async function analyzeVisual(
  ai: GoogleGenAI,
  image: { mimeType: string; data: string },
  targetLanguage: string
) {
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MEMORY_MODEL || "gemini-3.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: image },
          {
            text: [
              "Read the visible public-facing text in this travel image and translate it faithfully.",
              `Translate into ${targetLanguage}. Preserve names, numbers, prices, currencies, and uncertainty exactly; do not invent unreadable text.`,
              "Classify the surface as menu, sign, notice, placard, timetable, storefront, packaging, or other.",
              "Return short text blocks in visual reading order. If nothing is readable, return an empty textBlocks array.",
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: translationSchema,
    },
  });
  return parseVisualAnalysis(response.text);
}

async function createTranslatedImage(
  ai: GoogleGenAI,
  image: { mimeType: string; data: string },
  targetLanguage: string,
  analysis: { sourceLanguage: string; surfaceType: string; textBlocks: VisualTextBlock[] }
) {
  const translationGuide = analysis.textBlocks
    .map((block, index) => `${index + 1}. "${block.source}" => "${block.translation}"`)
    .join("\n");
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: image },
          {
            text: [
              "Edit this exact photograph into a faithful translated visual copy.",
              `Replace only the readable ${analysis.sourceLanguage} text with the supplied ${targetLanguage} translations.`,
              "Preserve the camera framing, people, objects, logos, prices, currency symbols, table structure, colors, and layout. Do not add or remove dishes, products, signs, or visual details.",
              "If a translation cannot fit naturally, keep the original text rather than inventing or obscuring content.",
              "Translation guide:",
              translationGuide || "No text was confidently readable; return the original image unchanged.",
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: { imageSize: "1K" },
    },
  });
  return response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.inlineData)
    .find((data): data is { data: string; mimeType: string } => Boolean(data?.data && data.mimeType?.startsWith("image/")));
}

function parseVisualAnalysis(text?: string) {
  try {
    const parsed = JSON.parse(text ?? "{}") as {
      sourceLanguage?: unknown;
      surfaceType?: unknown;
      textBlocks?: unknown;
    };
    const textBlocks = Array.isArray(parsed.textBlocks)
      ? parsed.textBlocks
          .map((block) => normalizeTextBlock(block))
          .filter((block): block is VisualTextBlock => Boolean(block))
          .slice(0, 24)
      : [];
    return {
      sourceLanguage: cleanText(parsed.sourceLanguage, 60) || "Unknown",
      surfaceType: normalizeSurfaceType(parsed.surfaceType),
      textBlocks,
    };
  } catch {
    throw new Error("Gemini returned an unreadable text translation.");
  }
}

function normalizeTextBlock(value: unknown): VisualTextBlock | undefined {
  if (!value || typeof value !== "object") return undefined;
  const block = value as Record<string, unknown>;
  const source = cleanText(block.source, 600);
  const translation = cleanText(block.translation, 600);
  const confidence = typeof block.confidence === "number" && Number.isFinite(block.confidence)
    ? Math.max(0, Math.min(1, block.confidence))
    : 0;
  return source && translation ? { source, translation, confidence } : undefined;
}

function parseImageDataUrl(value: string) {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return undefined;
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > maxImageBytes) return undefined;
  return { mimeType: match[1], data: match[2] };
}

function cleanLanguage(value: string) {
  return cleanText(value, 60).replace(/[^\p{L}\p{N} .'-]/gu, "");
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalizeSurfaceType(value: unknown) {
  const surface = cleanText(value, 30).toLowerCase();
  return ["menu", "sign", "notice", "placard", "timetable", "storefront", "packaging"].includes(surface)
    ? surface
    : "other";
}
