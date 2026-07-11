"use client";

import { Menu } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { acknowledge } from "./acknowledge";
import { CameraFlipButton } from "./CameraFlipButton";
import { ChatHistoryDrawer } from "./ChatHistoryDrawer";
import { ConnectionBadge } from "./ConnectionBadge";
import { RotationToggle } from "./RotationToggle";
import { useMagellanStore } from "./store";

export function OrientationGuard({ vertical, horizontal, onFlipCamera, onOpenLive }: { vertical: ReactNode; horizontal: ReactNode; onFlipCamera?: (nextFacingMode: "user" | "environment") => void; onOpenLive?: () => void }) {
  const orientation = useMagellanStore((state) => state.orientation);
  const isScrollingDown = useMagellanStore((state) => state.isScrollingDown);
  const setChatHistoryOpen = useMagellanStore((state) => state.setChatHistoryOpen);
  return (
    <motion.div className="relative h-full w-full overflow-hidden bg-[#0d0d0f]">
      {orientation === "vertical" ? (
        <motion.div
          className="magellan-header-container"
          animate={{ y: isScrollingDown ? -60 : 0, opacity: isScrollingDown ? 0 : 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
        >
          <button
            className="magellan-header__button magellan-menu"
            onClick={() => {
              acknowledge();
              setChatHistoryOpen(true);
            }}
            aria-label="Open chat history"
          >
            <Menu className="h-7 w-7" strokeWidth={1.55} />
          </button>
          <h1 className="magellan-header__title">Magellan</h1>
          <RotationToggle orientation={orientation} onOpenLive={onOpenLive} />
        </motion.div>
      ) : (
        <>
          <RotationToggle orientation={orientation} onOpenLive={onOpenLive} />
          <CameraFlipButton onFlip={onFlipCamera} />
        </>
      )}
      <ChatHistoryDrawer />
      <ConnectionBadge orientation={orientation} />
      <motion.div
        key={orientation}
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        {orientation === "vertical" ? vertical : horizontal}
      </motion.div>
    </motion.div>
  );
}
