"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { MemorySheet } from "./MemorySheet";
import { TreasureHuntPage } from "./TreasureHuntPage";
import { TripSelector } from "./TripSelector";
import { useMagellanStore } from "./store";

export function ChatThread({ compact = false }: { compact?: boolean }) {
  const messages = useMagellanStore((state) => state.messages);
  const isGenerating = useMagellanStore((state) => state.isGenerating);
  const liveTranscription = useMagellanStore((state) => state.liveTranscription);
  const inputText = useMagellanStore((state) => state.inputText);
  const isInputFocused = useMagellanStore((state) => state.isInputFocused);
  const cityGame = useMagellanStore((state) => state.cityGame);
  const isGamePageOpen = useMagellanStore((state) => state.isGamePageOpen);
  const setGamePageOpen = useMagellanStore((state) => state.setGamePageOpen);
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
    if (!element) return;
    if (isGenerating) stickToBottom.current = true;
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [isGenerating, liveTranscription, messages]);

  if (!compact && isGamePageOpen) return <TreasureHuntPage />;

  const hasConversation = messages.length > 0 || Boolean(liveTranscription);
  const hideWelcome = !compact && (isInputFocused || Boolean(inputText.trim()));
  const remaining = cityGame?.targets.filter((target) => !target.completed).length ?? 0;

  return (
    <section className={`chat-thread ${compact ? "chat-thread--compact" : ""}`} aria-label="Conversation">
      {!hasConversation ? (
        !hideWelcome ? (
          <div className="chat-thread__empty" aria-live="polite">
            {!compact && <><span className="chat-thread__welcome">Welcome to</span><TripSelector /><p>How can I help you today?</p></>}
          </div>
        ) : null
      ) : (
        <div className="chat-thread__messages" ref={scrollRef} onScroll={handleScroll}>
          {messages.map((message) => (
            <motion.article key={message.id} className={`chat-bubble chat-bubble--${message.role}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </motion.article>
          ))}
          {liveTranscription && <div className="live-transcription">{liveTranscription}</div>}
        </div>
      )}
      {!compact && (
        <div className="chat-thread__utilities">
          <MemorySheet inline />
          {cityGame && (
            <button className="treasure-summary" type="button" onClick={() => setGamePageOpen(true)}>
              <span><b>{`${cityGame.city} city finds`}</b><small>{remaining ? `${remaining} left` : "Complete"}</small></span>
              <span className="treasure-summary__open">View</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
