"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Camera, Check, Languages, Loader2, Maximize2, X } from "lucide-react";
import { acknowledge } from "./acknowledge";
import { useMagellanStore } from "./store";

type TranslationResult = {
  status: "ready" | "fallback" | "error";
  editedImageDataUrl?: string;
  fallbackMessage?: string;
  sourceLanguage: string;
  targetLanguage: string;
  surfaceType: string;
  textBlocks: Array<{ source: string; translation: string; confidence: number }>;
};

type HistoricalVideoResult = {
  status: "ready" | "error";
  title: string;
  summary: string;
  disclaimer: string;
  videoDataUrl?: string;
  fallbackMessage?: string;
};

export function HorizontalLayout({
  cameraFeed,
  glassPanel,
  onToggleVoice,
  captureStill,
  onValidateTreasure,
  targetLanguage,
  historicalVideoRequest,
  voiceBubble,
}: {
  cameraFeed: ReactNode;
  glassPanel: ReactNode;
  onToggleVoice: () => void;
  captureStill: () => string | undefined;
  onValidateTreasure: (imageDataUrl: string) => void;
  targetLanguage: string;
  historicalVideoRequest?: { id: string; topic: string; context?: string };
  voiceBubble?: ReactNode;
}) {
  const isVoiceActive = useMagellanStore((state) => state.isVoiceActive);
  const setCameraActive = useMagellanStore((state) => state.setCameraActive);
  const cityGame = useMagellanStore((state) => state.cityGame);
  const activeTargetId = useMagellanStore((state) => state.activeGameTargetId);
  const gameNotice = useMagellanStore((state) => state.gameNotice);
  const [capturedImage, setCapturedImage] = useState<string>();
  const [translation, setTranslation] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [translationResult, setTranslationResult] = useState<TranslationResult>();
  const [translationError, setTranslationError] = useState<string>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [historicalVideoResponse, setHistoricalVideoResponse] = useState<{ requestId: string; result: HistoricalVideoResult }>();
  const [dismissedHistoricalVideoId, setDismissedHistoricalVideoId] = useState<string>();

  useEffect(() => {
    setCameraActive(true);
  }, [setCameraActive]);

  useEffect(() => {
    if (!historicalVideoRequest) return;
    const controller = new AbortController();
    void fetch("/api/historical-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: historicalVideoRequest.topic, context: historicalVideoRequest.context }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as HistoricalVideoResult & { error?: string };
        if (!response.ok || body.error) throw new Error(body.error || "Historical video generation failed.");
        setHistoricalVideoResponse({ requestId: historicalVideoRequest.id, result: body });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHistoricalVideoResponse({
          requestId: historicalVideoRequest.id,
          result: {
            status: "error",
            title: `A moment from ${historicalVideoRequest.topic}`,
            summary: "The historical scene could not be rendered.",
            disclaimer: "AI-generated reconstructions are illustrative, not archival footage.",
            fallbackMessage: error instanceof Error ? error.message : "Historical video generation failed.",
          },
        });
      });
    return () => controller.abort();
  }, [historicalVideoRequest]);

  const latestHistoricalVideoResponse = historicalVideoResponse;
  const historicalVideoResult = latestHistoricalVideoResponse && latestHistoricalVideoResponse.requestId === historicalVideoRequest?.id
    ? latestHistoricalVideoResponse.result
    : undefined;
  const historicalVideo = !historicalVideoRequest || dismissedHistoricalVideoId === historicalVideoRequest.id
    ? "idle"
    : historicalVideoResult?.status === "ready"
      ? "ready"
      : historicalVideoResult
        ? "error"
        : "loading";

  function closePopup() {
    if (translation === "loading") return;
    setCapturedImage(undefined);
    setTranslation("idle");
    setTranslationResult(undefined);
    setTranslationError(undefined);
  }

  function handleCapture() {
    const image = captureStill();
    if (!image) {
      onToggleVoice();
      return;
    }
    acknowledge();
    setCapturedImage(image);
    setTranslation("idle");
    setTranslationResult(undefined);
    setTranslationError(undefined);
    setIsFullscreen(false);
    if (cityGame?.targets.some((target) => target.id === activeTargetId && !target.completed) || cityGame?.targets.some((target) => !target.completed)) {
      onValidateTreasure(image);
    }
  }

  async function handleTranslate() {
    if (!capturedImage || translation === "loading") return;
    acknowledge();
    setTranslation("loading");
    setTranslationError(undefined);
    try {
      const response = await fetch("/api/visual-translation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: capturedImage, targetLanguage }),
      });
      const body = (await response.json().catch(() => ({}))) as TranslationResult & { error?: string };
      if (!response.ok || body.error) throw new Error(body.error || "Visual translation failed.");
      setTranslationResult(body);
      setTranslation("ready");
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "Visual translation failed.");
      setTranslation("error");
    }
  }

  const displayImage = translationResult?.editedImageDataUrl ?? capturedImage;

  return (
    <div className="relative h-full w-full overflow-hidden bg-charcoal">
      <div className="absolute inset-0">
        {cameraFeed}
        <div className={`camera-aura ${isVoiceActive ? "is-active" : ""}`} />
        {voiceBubble}
      </div>

      <aside className="pointer-events-none absolute bottom-4 right-4 top-4 z-10 flex w-[28%] min-w-[14rem] max-w-[24rem] flex-col overflow-hidden rounded-[36px]">
        <div className="pointer-events-auto min-h-0 flex-1 overflow-hidden rounded-[36px]">{glassPanel}</div>
      </aside>

      <div className="absolute bottom-7 left-7 z-20 flex flex-col items-center">
        <motion.button
          type="button"
          onClick={handleCapture}
          className="grid h-14 w-14 place-items-center rounded-full border-[3px] border-white bg-white/10 shadow-2xl backdrop-blur-sm transition hover:bg-white/20"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.9 }}
          aria-label="Capture image"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white shadow-inner"><Camera size={19} className="text-[#343238]" /></span>
        </motion.button>
      </div>

      <AnimatePresence>
        {capturedImage && !isFullscreen && (
          <motion.section
            className="translation-popover"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            aria-label="Visual translation"
          >
            <button type="button" onClick={closePopup} className="translation-popover__close" aria-label="Close translation preview" disabled={translation === "loading"}><X size={14} /></button>
            <div className={`translation-popover__image ${translation === "loading" ? "is-loading" : ""}`}>
              {translation === "ready" && displayImage ? (
                <button type="button" className="translation-popover__expand-button" onClick={() => setIsFullscreen(true)} aria-label="Open translated image fullscreen">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={displayImage} alt="AI-rendered translation" />
                  <span className="translation-popover__expand"><Maximize2 size={14} /> Tap to expand</span>
                </button>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={displayImage} alt="Captured camera frame" />
              )}
              {translation === "loading" && <span className="translation-popover__loading"><Loader2 size={20} className="animate-spin" /></span>}
            </div>
            <div className="translation-popover__footer">
              {translation === "idle" && <button type="button" className="translation-popover__translate" onClick={handleTranslate}><Languages size={14} /> Translate</button>}
              {translation === "loading" && <span>Rendering {targetLanguage}</span>}
              {translation === "ready" && <span>{translationResult?.status === "fallback" ? "Extracted translation ready" : "Translated copy ready"}</span>}
              {translation === "error" && <span className="translation-popover__error"><AlertCircle size={13} /> {translationError}</span>}
            </div>
          </motion.section>
        )}

        {isFullscreen && displayImage && (
          <motion.div className="absolute inset-0 z-40 grid place-items-center bg-[#0d0d0f]/95 p-8 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" className="absolute right-6 top-6 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white" onClick={() => setIsFullscreen(false)}>Back</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={displayImage} alt="AI-rendered translated visual" className="h-full w-full object-contain" />
          </motion.div>
        )}

        {historicalVideo !== "idle" && (
          <motion.section
            className="absolute bottom-6 left-1/2 z-30 w-[min(25rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-[1.7rem] border border-white/30 bg-[#15141a]/92 text-white shadow-[0_20px_60px_rgba(0,0,0,0.48)] backdrop-blur-2xl"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ type: "spring", damping: 26, stiffness: 310 }}
            aria-live="polite"
            aria-label="Historical reconstruction"
          >
            <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
              <div>
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#b9adff]">TimeLens reconstruction</p>
                <h2 className="mt-1 text-base font-semibold leading-tight">{historicalVideo === "loading" ? "Reconstructing this moment…" : historicalVideoResult?.title}</h2>
              </div>
              {historicalVideo !== "loading" && <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/20" onClick={() => setDismissedHistoricalVideoId(historicalVideoRequest?.id)} aria-label="Close historical reconstruction"><X size={16} /></button>}
            </div>
            {historicalVideo === "loading" ? (
              <div className="flex aspect-video items-center justify-center gap-3 bg-black/35 text-sm text-white/75">
                <Loader2 className="animate-spin" size={21} /> Creating an illustrative scene
              </div>
            ) : historicalVideo === "ready" && historicalVideoResult?.videoDataUrl ? (
              <video className="aspect-video w-full bg-black object-cover" src={historicalVideoResult.videoDataUrl} autoPlay muted playsInline controls preload="metadata" />
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-black/35 px-5 text-center text-sm text-white/75">
                <AlertCircle size={22} className="text-[#f4b8a6]" />
                <span>{historicalVideoResult?.fallbackMessage || "The reconstruction was unavailable."}</span>
              </div>
            )}
            {historicalVideo !== "loading" && (
              <div className="space-y-1 px-4 py-3">
                <p className="text-xs leading-5 text-white/80">{historicalVideoResult?.summary}</p>
                <p className="text-[0.64rem] leading-4 text-white/45">{historicalVideoResult?.disclaimer}</p>
              </div>
            )}
          </motion.section>
        )}

        {gameNotice && (
          <motion.div className={`game-notice game-notice--${gameNotice.tone}`} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {gameNotice.tone === "success" && <Check size={16} />}
            <span>{gameNotice.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
