import { Camera, Home } from "lucide-react";
import { motion } from "framer-motion";
import { useCallback } from "react";
import { acknowledge } from "./acknowledge";
import { useMagellanStore } from "./store";

type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

export function RotationToggle({ orientation, onOpenLive }: { orientation: "vertical" | "horizontal"; onOpenLive?: () => void }) {
  const setOrientation = useMagellanStore((state) => state.setOrientation);
  const isVertical = orientation === "vertical";
  const handleToggle = useCallback(() => {
    const next = isVertical ? "horizontal" : "vertical";
    setOrientation(next);
    if (next === "horizontal") onOpenLive?.();
    if (next === "horizontal" && document.fullscreenEnabled) {
      void document.documentElement.requestFullscreen?.().then(() =>
        (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape")
      );
    } else if (next === "vertical") {
      screen.orientation?.unlock?.();
      void document.exitFullscreen?.();
    }
    acknowledge();
  }, [isVertical, onOpenLive, setOrientation]);
  return (
    <motion.button
      onClick={handleToggle}
      className={`absolute z-50 grid h-11 w-11 place-items-center rounded-full ${isVertical ? "right-4 top-[calc(2rem+env(safe-area-inset-top,0px))] border border-white/20 bg-white/10 backdrop-blur-sm" : "left-4 top-[calc(1rem+env(safe-area-inset-top,0px))] border border-white/15 bg-black/40"}`}
      whileTap={{ scale: 0.9 }}
      whileHover={{ rotate: 180 }}
      aria-label={isVertical ? "Open live camera" : "Close live camera"}
    >
      {isVertical ? <Camera className="h-5 w-5 text-[#50483f]" /> : <Home className="h-5 w-5 text-white/85" />}
    </motion.button>
  );
}
