import { motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { useMagellanStore } from "./store";

export function InputBar({ onSend, onToggleVoice }: { onSend: (text: string) => void; onToggleVoice: () => void }) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isVoiceActive = useMagellanStore((state) => state.isVoiceActive);
  const handleSubmit = useCallback(() => {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [onSend, text]);
  const hasText = Boolean(text.trim());
  return (
    <motion.div className="magellan-input" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          event.target.style.height = "auto";
          event.target.style.height = `${Math.min(event.target.scrollHeight, 96)}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={isVoiceActive ? "Listening…" : "Ask Magellan"}
        className="max-h-24 min-w-0 flex-1 resize-none overflow-hidden bg-transparent px-1.5 py-1 text-[16px] leading-relaxed text-[#24201b] outline-none placeholder:text-[#8e877d]"
      />
      <motion.button
        onClick={hasText ? handleSubmit : onToggleVoice}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${hasText ? "bg-[#b9a388]" : isVoiceActive ? "animate-pulse bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.55)]" : "border border-[#cfbead] bg-[#e4d7c8]"}`}
        whileTap={{ scale: 0.92 }}
        aria-label={hasText ? "Send message" : "Toggle voice"}
      >
        {hasText ? (
          <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
        ) : (
          <svg className={`h-[17px] w-[17px] ${isVoiceActive ? "text-white" : "text-[#554b3f]"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
        )}
      </motion.button>
    </motion.div>
  );
}
