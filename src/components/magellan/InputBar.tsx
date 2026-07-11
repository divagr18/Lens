import { useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useMagellanStore } from './store';

interface Props {
  onSend: (text: string) => void;
  onToggleVoice: () => void;
}

/**
 * Vertical-mode input bar.
 * Uses a <textarea> (rows=1, auto-resize) so multi-line input doesn't
 * require the user to scroll inside a fixed-height box.
 * The wrapping layout uses visualViewport height so the bar stays
 * above the on-screen keyboard rather than being pushed underneath it.
 */
export function InputBar({ onSend, onToggleVoice }: Props) {
  const text = useMagellanStore((s) => s.inputText);
  const setText = useMagellanStore((s) => s.setInputText);
  const setInputFocused = useMagellanStore((s) => s.setInputFocused);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isVoiceActive = useMagellanStore((s) => s.isVoiceActive);

  /* Auto-grow the textarea up to ~5 lines, then scroll */
  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    resize(e.target);
  };

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, onSend, setText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleMicToggle = useCallback(() => onToggleVoice(), [onToggleVoice]);

  const hasText = text.trim().length > 0;

  return (
    <motion.div
      className="magellan-input"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.1 }}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setInputFocused(true)}
        onBlur={() => setInputFocused(false)}
        placeholder={isVoiceActive ? 'Listening\u2026' : 'Ask Magellan'}
        className="flex-1 min-w-0 resize-none overflow-hidden bg-transparent text-[16px]
                   text-[#24201b] placeholder:text-[#8e877d]
                   outline-none border-none leading-relaxed
                   max-h-[96px] py-1 px-1.5 m-0"
        style={{ minHeight: '1.5rem' }}
      />

      {/* ── Action button (Mic or Send) ── */}
      <motion.button
        id="input-bar-action-btn"
        onClick={hasText ? handleSubmit : handleMicToggle}
        className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center transition-colors
          ${hasText
            ? 'bg-[#b9a388] shadow-md shadow-[#a89175]/25'
            : isVoiceActive
              ? 'bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.55)] animate-pulse'
              : 'bg-[#e4d7c8] hover:bg-[#d8caa6] border border-[#cfbead]'
          }`}
        whileTap={{ scale: 0.92 }}
        aria-label={hasText ? "Send message" : "Toggle voice"}
      >
        {hasText ? (
          <svg
            className="w-[14px] h-[14px] text-white ml-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
        ) : (
          <svg
            className={`w-[17px] h-[17px] ${isVoiceActive ? 'text-white' : 'text-[#554b3f]'}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        )}
      </motion.button>
    </motion.div>
  );
}
