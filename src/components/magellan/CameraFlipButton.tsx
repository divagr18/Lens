import { motion } from "framer-motion";
import { acknowledge } from "./acknowledge";
import { useMagellanStore } from "./store";

export function CameraFlipButton({ onFlip }: { onFlip?: (nextFacingMode: "user" | "environment") => void }) {
  const facingMode = useMagellanStore((state) => state.facingMode);
  const toggleFacingMode = useMagellanStore((state) => state.toggleFacingMode);
  return (
    <motion.button
      onClick={() => {
        acknowledge();
        const nextFacingMode = facingMode === "environment" ? "user" : "environment";
        toggleFacingMode();
        onFlip?.(nextFacingMode);
      }}
      className="absolute left-4 top-[calc(4.25rem+env(safe-area-inset-top,0px))] z-50 grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/40"
      whileTap={{ scale: 0.9 }}
      aria-label={facingMode === "environment" ? "Switch to front camera" : "Switch to back camera"}
    >
      <svg className="h-5 w-5 text-white/85" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6.34 7.75A6.99 6.99 0 0 1 12 5c3.87 0 7 3.13 7 7 0 .37-.03.73-.09 1.09" />
        <path d="M17.66 16.25A6.99 6.99 0 0 1 12 19c-3.87 0-7-3.13-7-7 0-.37.03-.73.09-1.09" />
        <polyline points="10,5 6.34,7.75 9.5,10" />
        <polyline points="14,19 17.66,16.25 14.5,14" />
        <rect x="7" y="8" width="10" height="9" rx="3" />
        <circle cx="12" cy="12.5" r="2" />
      </svg>
    </motion.button>
  );
}
