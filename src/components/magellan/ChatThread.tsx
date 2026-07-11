import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { MemorySheet } from "./MemorySheet";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useMagellanStore } from "./store";
import { TripSelector } from "./TripSelector";

export function ChatThread({ compact = false }: { compact?: boolean }) {
  const messages = useMagellanStore((state) => state.messages);
  const liveTranscription = useMagellanStore((state) => state.liveTranscription);
  const setScrollingDown = useMagellanStore((state) => state.setScrollingDown);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    const delta = element.scrollTop - lastScrollTop.current;
    if (delta > 5) setScrollingDown(true);
    else if (delta < -5) setScrollingDown(false);
    lastScrollTop.current = element.scrollTop;
  }, [setScrollingDown]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages, liveTranscription]);

  return (
    <section className={`chat-thread ${compact ? "chat-thread--compact" : ""}`} aria-label="Conversation">
      {!compact && <MemorySheet />}
      {messages.length === 0 && !liveTranscription ? (
        <div className="chat-thread__empty" aria-live="polite">
          {!compact && <><span className="chat-thread__welcome">Welcome to</span><TripSelector /></>}
          <p>{compact ? "Point your camera and speak" : "How can I help you today?"}</p>
        </div>
      ) : (
        <div className="chat-thread__messages" ref={scrollRef} onScroll={handleScroll}>
          {messages.map((message) => (
            <motion.article key={message.id} className={`chat-bubble chat-bubble--${message.role}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </motion.article>
          ))}
          {liveTranscription && <div className="live-transcription">{liveTranscription}</div>}
        </div>
      )}
    </section>
  );
}
