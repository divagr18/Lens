"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureDefaultTripRegistry, loadActiveTripId } from "@/lib/trip-registry";
import type { TripProfile } from "@/lib/travel-types";
import { ChatThread } from "./ChatThread";
import { CameraFeed } from "./CameraFeed";
import { HorizontalLayout } from "./HorizontalLayout";
import { InputBar } from "./InputBar";
import { OrientationGuard } from "./OrientationGuard";
import type { CityGame } from "./store";
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
  const messages = useMagellanStore((state) => state.messages);
  const hasStartedChat = useMagellanStore((state) => state.messages.length > 0);
  const activeTripId = useMagellanStore((state) => state.activeTripId);
  const facingMode = useMagellanStore((state) => state.facingMode);
  const activeDestination = useMagellanStore((state) => state.trips.find((trip) => trip.id === state.activeTripId)?.destination);
  const cityGame = useMagellanStore((state) => state.cityGame);
  const setCityGame = useMagellanStore((state) => state.setCityGame);
  const setGameNotice = useMagellanStore((state) => state.setGameNotice);
  const setGamePageOpen = useMagellanStore((state) => state.setGamePageOpen);
  const setCameraActive = useMagellanStore((state) => state.setCameraActive);
  const [tripProfiles] = useState<TripProfile[]>(() => ensureDefaultTripRegistry());
  const videoRef = useRef<HTMLVideoElement>(null);
  const gameRequestRef = useRef<string | undefined>(undefined);
  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock();

  useEffect(() => {
    if (!tripProfiles.length) return;
    replaceTrips(
      tripProfiles.map((trip) => ({ id: trip.id, destination: trip.destinationCity || "Untitled trip" })),
      loadActiveTripId()
    );
  }, [replaceTrips, tripProfiles]);

  const activeTrip = useMemo(() => tripProfiles.find((trip) => trip.id === activeTripId), [activeTripId, tripProfiles]);
  const savedActiveTrip = useMemo(() => tripProfiles.find((trip) => trip.id === loadActiveTripId()), [tripProfiles]);
  const live = useLensLiveSession({ trip: activeTrip, facingMode, videoRef });
  const {
    isReady: liveIsReady,
    mediaStream,
    captureStill,
    gameRequest,
    sendGameContext,
    switchCamera,
    historicalVideoRequest,
    translationRequest,
    start: startLive,
    status: liveStatus,
    stop: stopLive,
  } = live;

  const gameCity = savedActiveTrip?.destinationCity || activeTrip?.destinationCity || activeDestination || "Bengaluru";
  const translationLanguage = defaultTranslationLanguage(activeTrip?.languagePreferences);
  const shellCityClass = cityBackgroundClass(activeTrip?.destinationCity || activeDestination);

  const createCityGame = useCallback(async (requestedCity = gameCity) => {
    const city = requestedCity.trim();
    if (!city) return;
    setGameNotice({ id: crypto.randomUUID(), tone: "info", message: "Preparing city activity…" });
    try {
      const response = await fetch("/api/games/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city }),
      });
      const body = (await response.json().catch(() => ({}))) as { game?: CityGame; error?: string };
      if (!response.ok || !body.game) throw new Error(body.error || "Could not create a city treasure hunt.");
      setCityGame(body.game);
      sendGameContext(body.game);
      setGameNotice({ id: crypto.randomUUID(), tone: "success", message: "City activity is ready." });
    } catch (error) {
      setGameNotice({ id: crypto.randomUUID(), tone: "error", message: error instanceof Error ? error.message : "Could not prepare the city activity." });
    }
  }, [gameCity, sendGameContext, setCityGame, setGameNotice]);

  const validateTreasureCapture = useCallback((imageDataUrl: string) => {
    const game = useMagellanStore.getState().cityGame;
    const targetId = useMagellanStore.getState().activeGameTargetId
      ?? game?.targets.find((target) => !target.completed)?.id;
    if (!game || !targetId) return;
    setGameNotice({ id: crypto.randomUUID(), tone: "info", message: "Checking this capture…" });
    void fetch("/api/games/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: game.gameId, targetId, imageDataUrl }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { completed?: boolean; feedback?: string; game?: CityGame; error?: string };
        if (!response.ok || !body.game) throw new Error(body.error || "Could not check that target.");
        setCityGame(body.game);
        sendGameContext(body.game);
        setGameNotice({
          id: crypto.randomUUID(),
          tone: body.completed ? "success" : "info",
          message: body.completed ? "Capture matched." : "Try another view.",
        });
      })
      .catch((error) => setGameNotice({ id: crypto.randomUUID(), tone: "error", message: error instanceof Error ? error.message : "Could not validate that capture." }));
  }, [sendGameContext, setCityGame, setGameNotice]);

  const toggleLive = useCallback(() => {
    if (liveIsReady) {
      stopLive();
      return;
    }
    setOrientation("horizontal");
    void startLive();
  }, [liveIsReady, setOrientation, startLive, stopLive]);

  const handleSend = useCallback(
    async (text: string) => {
      const userMessage = { id: crypto.randomUUID(), role: "user" as const, content: text };
      addMessage(userMessage);
      setIsGenerating(true);
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history: [...messages, userMessage], trip: activeTrip }),
        });
        const body = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
        if (!response.ok || !body.answer) throw new Error(body.error || "Chat could not respond.");
        addMessage({ id: crypto.randomUUID(), role: "assistant", content: body.answer });
      } catch (error) {
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: error instanceof Error ? `I couldn't reply just now: ${error.message}` : "I couldn't reply just now.",
        });
      } finally {
        setIsGenerating(false);
      }
    },
    [activeTrip, addMessage, messages, setIsGenerating]
  );

  useEffect(() => {
    if (cityGame && cityGame.city.toLowerCase() === gameCity.toLowerCase()) return;
    if (gameRequestRef.current === gameCity) return;
    gameRequestRef.current = gameCity;
    void createCityGame(gameCity);
  }, [cityGame, createCityGame, gameCity]);

  useEffect(() => {
    if (liveIsReady && cityGame) sendGameContext(cityGame);
  }, [cityGame, liveIsReady, sendGameContext]);

  useEffect(() => {
    if (!gameRequest?.city) return;
    gameRequestRef.current = undefined;
    void createCityGame(gameRequest.city);
  }, [createCityGame, gameRequest]);

  const gameNotice = useMagellanStore((state) => state.gameNotice);
  useEffect(() => {
    if (!gameNotice) return;
    const timeout = window.setTimeout(() => setGameNotice(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [gameNotice, setGameNotice]);

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
        onOpenLive={() => {
          if (!liveIsReady) void startLive();
        }}
        onCloseLive={() => {
          setGamePageOpen(false);
          setCameraActive(false);
          if (liveIsReady) stopLive("Live camera closed.");
        }}
        vertical={
          <VerticalLayout
            className={`magellan-shell ${shellCityClass} ${hasStartedChat ? "magellan-shell--chatting" : ""}`}
            chat={<ChatThread />}
            inputBar={<InputBar onSend={handleSend} onToggleVoice={toggleLive} />}
          />
        }
        horizontal={
          <HorizontalLayout
            cameraFeed={<CameraFeed videoRef={videoRef} stream={mediaStream} status={liveStatus} />}
            glassPanel={<ChatThread compact />}
            onToggleVoice={toggleLive}
            captureStill={captureStill}
            onValidateTreasure={validateTreasureCapture}
            targetLanguage={translationRequest?.targetLanguage || translationLanguage}
            historicalVideoRequest={historicalVideoRequest}
            voiceBubble={<VoiceBubble stream={mediaStream ?? null} className="pointer-events-none absolute bottom-5 left-5 z-[2]" />}
          />
        }
      />
    </main>
  );
}

function defaultTranslationLanguage(preferences?: string) {
  const supported = ["English", "Hindi", "Kannada", "Tamil", "Telugu", "Japanese", "Korean", "French", "Spanish", "German", "Italian"];
  return supported.find((language) => preferences?.toLowerCase().includes(language.toLowerCase())) || "English";
}

function cityBackgroundClass(city?: string) {
  const normalized = city?.trim().toLowerCase() || "";
  if (normalized.includes("tokyo")) return "magellan-shell--tokyo";
  if (normalized.includes("london")) return "magellan-shell--london";
  return "magellan-shell--bengaluru";
}
