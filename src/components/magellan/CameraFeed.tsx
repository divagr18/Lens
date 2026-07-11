"use client";

import { motion } from "framer-motion";
import { useEffect, type RefObject } from "react";

/** Magellan's camera presentation now renders the one stream owned by Lens Live. */
export function CameraFeed({ videoRef, stream, status }: { videoRef: RefObject<HTMLVideoElement | null>; stream?: MediaStream; status: string }) {
  useEffect(() => {
    if (!videoRef.current || !stream) return;
    videoRef.current.srcObject = stream;
    void videoRef.current.play();
  }, [stream, videoRef]);
  if (!stream) {
    return <div className="absolute inset-0 grid place-items-center bg-[#0d0d0f]"><p className="max-w-xs rounded-3xl border border-white/10 bg-black/50 p-6 text-center text-sm text-white/70">{status}</p></div>;
  }
  return <motion.video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />;
}
