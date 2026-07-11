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

export function HorizontalLayout({
  cameraFeed,
  glassPanel,
  onToggleVoice,
  captureStill,
  onValidateTreasure,
  targetLanguage,
  voiceBubble,
}: {
  cameraFeed: ReactNode;
  glassPanel: ReactNode;
  onToggleVoice: () => void;
  captureStill: () => string | undefined;
  onValidateTreasure: (imageDataUrl: string) => void;
  targetLanguage: string;
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

  useEffect(() => {
    setCameraActive(true);
  }, [setCameraActive]);

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
                </button>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={displayImage} alt="Captured camera frame" />
              )}
              {translation === "loading" && <span className="translation-popover__loading"><Loader2 size={20} className="animate-spin" /></span>}
              {translation === "ready" && displayImage && <span className="translation-popover__expand"><Maximize2 size={14} /> Tap to expand</span>}
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
            <button type="button" className="absolute left-6 top-6 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white" onClick={() => setIsFullscreen(false)}>Back</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={displayImage} alt="AI-rendered translated visual" className="h-full w-full object-contain" />
          </motion.div>
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
