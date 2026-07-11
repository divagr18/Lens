import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

interface Props {
  chat: ReactNode;
  inputBar: ReactNode;
  className?: string;
}

function useVisualViewport() {
  const [viewport, setViewport] = useState<{ height: number; offsetTop: number } | null>(null);
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    const update = () => setViewport({ height: visualViewport.height, offsetTop: visualViewport.offsetTop });
    update();
    visualViewport.addEventListener("resize", update);
    visualViewport.addEventListener("scroll", update);
    return () => {
      visualViewport.removeEventListener("resize", update);
      visualViewport.removeEventListener("scroll", update);
    };
  }, []);
  return viewport;
}

export function VerticalLayout({ chat, inputBar, className = "" }: Props) {
  const viewport = useVisualViewport();
  return (
    <div
      className={`absolute left-0 right-0 flex flex-col overflow-hidden px-safe ${className}`}
      style={viewport ? { top: viewport.offsetTop, height: viewport.height } : { insetBlock: 0 }}
    >
      <motion.div className="min-h-0 flex-1 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {chat}
      </motion.div>
      <div className="magellan-composer shrink-0 px-9 pt-2" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}>
        {inputBar}
        <div className="gemini-credit" aria-label="Powered by Google">
          <span>Powered by</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/google-logo.png" alt="Google" />
        </div>
      </div>
    </div>
  );
}
