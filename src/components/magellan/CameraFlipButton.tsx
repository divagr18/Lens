import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { useMagellanStore } from './store';
import { acknowledge } from './acknowledge';

export function CameraFlipButton({ onFlip }: { onFlip?: (nextFacingMode: "user" | "environment") => void }) {
  const facingMode = useMagellanStore((s) => s.facingMode);
  const toggleFacingMode = useMagellanStore((s) => s.toggleFacingMode);

  return (
    <motion.button
      onClick={() => {
        acknowledge();
        const nextFacingMode = facingMode === 'environment' ? 'user' : 'environment';
        toggleFacingMode();
        onFlip?.(nextFacingMode);
      }}
      className="absolute z-50 w-11 h-11 rounded-full flex items-center justify-center
                 bg-black/40 border border-white/15 left-4
                 top-[calc(4.25rem+env(safe-area-inset-top,0px))]"
      whileTap={{ scale: 0.9 }}
      aria-label={facingMode === 'environment' ? 'Switch to front camera' : 'Switch to back camera'}
    >
      <RefreshCw className="w-5 h-5 text-white/85" strokeWidth={1.8} aria-hidden="true" />
    </motion.button>
  );
}
