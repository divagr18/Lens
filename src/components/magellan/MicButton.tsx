import { AnimatePresence, motion } from "framer-motion";

export function MicButton({ isActive, onToggle }: { isActive: boolean; onToggle: () => void }) {
  return (
    <motion.button
      onClick={onToggle}
      className="relative grid h-12 w-12 place-items-center rounded-full border border-white/20 bg-white/10"
      whileTap={{ scale: 0.9 }}
      aria-label={isActive ? "Stop microphone" : "Start microphone"}
    >
      <AnimatePresence mode="wait">
        {isActive ? (
          <motion.div key="active" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="h-3 w-3 rounded-sm bg-red-400" />
        ) : (
          <motion.svg key="idle" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="h-5 w-5 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </motion.svg>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
