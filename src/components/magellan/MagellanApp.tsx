"use client";

import { useCallback, useEffect } from "react";
import { loadActiveTripId, loadSavedTrips } from "@/lib/trip-registry";
import { ChatThread } from "./ChatThread";
import { CameraFeed } from "./CameraFeed";
import { HorizontalLayout } from "./HorizontalLayout";
import { InputBar } from "./InputBar";
import { OrientationGuard } from "./OrientationGuard";
import { useMagellanStore } from "./store";
import { VerticalLayout } from "./VerticalLayout";

export function MagellanApp() {
  const addMessage = useMagellanStore((state) => state.addMessage);
  const setIsGenerating = useMagellanStore((state) => state.setIsGenerating);
  const replaceTrips = useMagellanStore((state) => state.replaceTrips);
  const hasStartedChat = useMagellanStore((state) => state.messages.length > 0);

  useEffect(() => {
    const savedTrips = loadSavedTrips();
    if (!savedTrips.length) return;
    replaceTrips(
      savedTrips.map((trip) => ({ id: trip.id, destination: trip.destinationCity || "Untitled trip" })),
      loadActiveTripId()
    );
  }, [replaceTrips]);

  const handleSend = useCallback(
    (text: string) => {
      addMessage({ id: crypto.randomUUID(), role: "user", content: text });
      setIsGenerating(true);
    },
    [addMessage, setIsGenerating]
  );

  return (
    <main className="magellan-root">
      <OrientationGuard
        vertical={
          <VerticalLayout
            className={hasStartedChat ? "magellan-shell magellan-shell--chatting" : "magellan-shell"}
            chat={<ChatThread />}
            inputBar={<InputBar onSend={handleSend} />}
          />
        }
        horizontal={<HorizontalLayout cameraFeed={<CameraFeed />} glassPanel={<ChatThread compact />} />}
      />
    </main>
  );
}
