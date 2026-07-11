"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMagellanStore } from "./store";

/** Ported from Magellan; the next module replaces this owned stream with Lens Live's shared stream. */
export function CameraFeed() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const facingMode = useMagellanStore((state) => state.facingMode);
  const [hasPermission, setHasPermission] = useState(true);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      setHasPermission(true);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setHasPermission(false);
    }
  }, [facingMode]);

  useEffect(() => {
    const startTimer = window.setTimeout(() => void startCamera(), 0);
    return () => {
      window.clearTimeout(startTimer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [startCamera]);

  if (!hasPermission) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-[#0d0d0f]">
        <p className="rounded-3xl border border-white/10 bg-black/50 p-6 text-center text-sm text-white/70">Camera permission was denied. Allow camera access, then reopen live mode.</p>
      </div>
    );
  }
  return <motion.video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />;
}
