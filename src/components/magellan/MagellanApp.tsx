"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadActiveTripId, loadSavedTrips } from "@/lib/trip-registry";
import type { TripProfile } from "@/lib/travel-types";
import { ChatThread } from "./ChatThread";
import { CameraFeed } from "./CameraFeed";
import { GlassPanel } from "./GlassPanel";
import { HorizontalLayout } from "./HorizontalLayout";
import { InputBar } from "./InputBar";
import { OrientationGuard } from "./OrientationGuard";
import { useMagellanStore } from "./store";
import { useLensLiveSession } from "./useLensLiveSession";
import { useWakeLock } from "./useWakeLock";
import { VerticalLayout } from "./VerticalLayout";
import { VoiceBubble } from "./VoiceBubble";

export function MagellanApp() {
  const addMessage = useMagellanStore((state) => state.addMessage);
  const setIsGenerating = useMagellanStore((state) => state.setIsGenerating);
  const setOrientation = useMagellanStore((state) => state.setOrientation);
  const replaceTrips = useMagellanStore((state) => state.replaceTrips);
  const hasStartedChat = useMagellanStore((state) => state.messages.length > 0);
  const activeTripId = useMagellanStore((state) => state.activeTripId);
  const facingMode = useMagellanStore((state) => state.facingMode);
  const [tripProfiles] = useState<TripProfile[]>(() => loadSavedTrips());
  const videoRef = useRef<HTMLVideoElement>(null);
  const queuedTextRef = useRef<string | undefined>(undefined);
  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock();

  useEffect(() => {
    if (!tripProfiles.length) return;
    replaceTrips(
      tripProfiles.map((trip) => ({ id: trip.id, destination: trip.destinationCity || "Untitled trip" })),
      loadActiveTripId()
    );
  }, [replaceTrips, tripProfiles]);

  const activeTrip = useMemo(() => tripProfiles.find((trip) => trip.id === activeTripId), [activeTripId, tripProfiles]);
  const live = useLensLiveSession({ trip: activeTrip, facingMode, videoRef });
  const {
    isReady: liveIsReady,
    mediaStream,
    sendText: sendLiveText,
    switchCamera,
    start: startLive,
    status: liveStatus,
    stop: stopLive,
  } = live;

  const toggleLive = useCallback(() => {
    if (liveIsReady) {
      stopLive();
      return;
    }
    setOrientation("horizontal");
    void startLive();
  }, [liveIsReady, setOrientation, startLive, stopLive]);

  const handleSend = useCallback(
    (text: string) => {
      addMessage({ id: crypto.randomUUID(), role: "user", content: text });
      if (sendLiveText(text)) return;
      queuedTextRef.current = text;
      setIsGenerating(true);
      setOrientation("horizontal");
      void startLive();
    },
    [addMessage, sendLiveText, setIsGenerating, setOrientation, startLive]
  );

  useEffect(() => {
    const queuedText = queuedTextRef.current;
    if (!liveIsReady || !queuedText) return;
    queuedTextRef.current = undefined;
    sendLiveText(queuedText);
  }, [liveIsReady, sendLiveText]);

  useEffect(() => {
    if (liveIsReady) {
      void requestWakeLock();
      return;
    }
    void releaseWakeLock();
  }, [liveIsReady, releaseWakeLock, requestWakeLock]);

  return (
    <main className="magellan-root">
      <OrientationGuard
        onFlipCamera={switchCamera}
        vertical={
          <VerticalLayout
            className={hasStartedChat ? "magellan-shell magellan-shell--chatting" : "magellan-shell"}
            chat={<ChatThread />}
            inputBar={<InputBar onSend={handleSend} onToggleVoice={toggleLive} />}
          />
        }
        horizontal={
          <HorizontalLayout
            cameraFeed={<CameraFeed videoRef={videoRef} stream={mediaStream} status={liveStatus} />}
            glassPanel={<GlassPanel className="h-full overflow-hidden p-0"><ChatThread compact /></GlassPanel>}
            onToggleVoice={toggleLive}
            voiceBubble={<VoiceBubble stream={mediaStream ?? null} className="pointer-events-none absolute bottom-5 left-5 z-[2]" />}
          />
        }
      />
    </main>
  );
}
