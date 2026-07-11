"use client";

import { Camera, Gamepad2, Languages, Mic, Square, Volume2, VolumeX, Wifi, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TripProfile } from "@/lib/travel-types";
import { loadActiveTripId, loadSavedTrips, setActiveTripId } from "@/lib/trip-registry";

type SocketMessage =
  | { type: "connected"; transport: string }
  | { type: "ready"; model: string }
  | { type: "input-transcript"; text: string; final: boolean }
  | { type: "output-transcript"; text: string; final: boolean }
  | { type: "output-audio"; data: string; mimeType: string }
  | { type: "interrupted" }
  | { type: "tool-status"; message: string }
  | { type: "visual-translation-request"; targetLanguage?: string }
  | { type: "city-game-request"; city?: string }
  | { type: "memory-status"; status: "curating" | "saved" | "skipped" | "error"; message: string }
  | { type: "location"; accuracy: number | null }
  | {
      type: "metrics";
      audioChunks: number;
      audioBytes: number;
      frames: number;
      frameBytes: number;
    }
  | { type: "error"; code: string; message: string }
  | { type: "closed"; reason: string };

type ServerMetrics = {
  audioChunks: number;
  audioBytes: number;
  frames: number;
  frameBytes: number;
};

type PhoneLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
};

type TranslationTextBlock = {
  source: string;
  translation: string;
  confidence: number;
};

type TranslationResult = {
  id: string;
  status: "ready" | "fallback" | "error";
  sourceLanguage: string;
  targetLanguage: string;
  surfaceType: string;
  textBlocks: TranslationTextBlock[];
  editedImageDataUrl?: string;
  fallbackMessage?: string;
};

type TranslationModalState = {
  originalImageDataUrl: string;
  targetLanguage: string;
  status: "working" | "ready" | "fallback";
  result?: TranslationResult;
  message?: string;
};

type CityGameTarget = {
  id: string;
  title: string;
  hint: string;
  successCriteria: string;
  points: number;
  completed: boolean;
};

type CityGame = {
  gameId: string;
  city: string;
  createdAt: string;
  score: number;
  targets: CityGameTarget[];
};

const emptyMetrics: ServerMetrics = {
  audioChunks: 0,
  audioBytes: 0,
  frames: 0,
  frameBytes: 0,
};

const defaultTripMemory = [
  "Budget: keep local transit and food under ₹2,500 per day; avoid expensive tourist traps unless the value is clear.",
  "Mobility: knee injury; avoid walking more than 1 km at a time, especially in rain or heat. Prefer metro, auto, or cab for longer stretches.",
  "Luggage: one carry-on suitcase; avoid routes with long walks, stairs, or crowded transfers when possible.",
  "Food: vegetarian; avoid shellfish, fish sauce, meat stock, and shared seafood gravies.",
].join("\n");

export default function LiveTestPage() {
  const [status, setStatus] = useState("Start the camera to connect.");
  const [isRunning, setIsRunning] = useState(false);
  const [hasMedia, setHasMedia] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [latestFrame, setLatestFrame] = useState<string>();
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [metrics, setMetrics] = useState<ServerMetrics>(emptyMetrics);
  const [locationStatus, setLocationStatus] = useState("GPS off");
  const [tripMemory] = useState(() => {
    if (typeof window === "undefined") return defaultTripMemory;
    return window.localStorage.getItem("lens-live-trip-memory") ?? defaultTripMemory;
  });
  const [savedTrips] = useState<TripProfile[]>(() => loadSavedTrips());
  const [activeTripId, setActiveTrip] = useState(() => loadActiveTripId());
  const [memoryStatus, setMemoryStatus] = useState("Select a saved trip to enable automatic memory updates.");
  const [targetLanguage, setTargetLanguage] = useState(() =>
    tripLanguage(savedTrips.find((trip) => trip.id === activeTripId))
  );
  const [translationModal, setTranslationModal] = useState<TranslationModalState>();
  const [showOriginalTranslationImage, setShowOriginalTranslationImage] = useState(false);
  const [gameCity, setGameCity] = useState(
    () => savedTrips.find((trip) => trip.id === activeTripId)?.destinationCity ?? ""
  );
  const [cityGame, setCityGame] = useState<CityGame>();
  const [gameStatus, setGameStatus] = useState("Choose a city and start a short public photo hunt.");
  const [gameBusy, setGameBusy] = useState(false);
  const activeTrip = savedTrips.find((trip) => trip.id === activeTripId);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextPlaybackTimeRef = useRef(0);
  const frameTimerRef = useRef<number | undefined>(undefined);
  const readyRef = useRef(false);
  const audioSamplesRef = useRef<Float32Array[]>([]);
  const audioSampleCountRef = useRef(0);
  const mutedRef = useRef(false);
  const phoneLocationRef = useRef<PhoneLocation | undefined>(undefined);
  const locationWatchRef = useRef<number | undefined>(undefined);
  const translationAbortRef = useRef<AbortController | undefined>(undefined);

  const clearAssistantAudio = useCallback(() => {
    audioSourcesRef.current.forEach((source) => source.stop());
    audioSourcesRef.current.clear();
    nextPlaybackTimeRef.current = audioContextRef.current?.currentTime ?? 0;
  }, []);

  const clearTimers = useCallback(() => {
    if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
    frameTimerRef.current = undefined;
  }, []);

  const releaseMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
    audioSamplesRef.current = [];
    audioSampleCountRef.current = 0;
    if (locationWatchRef.current !== undefined) {
      navigator.geolocation?.clearWatch(locationWatchRef.current);
      locationWatchRef.current = undefined;
    }
    phoneLocationRef.current = undefined;
    setHasMedia(false);
    setLocationStatus("GPS off");
  }, []);

  const stopSession = useCallback(
    (reason = "Stopped.") => {
      clearTimers();
      readyRef.current = false;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "stop" }));
      }
      socket?.close();
      releaseMedia();
      clearAssistantAudio();
      translationAbortRef.current?.abort();
      translationAbortRef.current = undefined;
      setTranslationModal(undefined);
      setCityGame(undefined);
      setGameBusy(false);
      setGameStatus("Choose a city and start a short public photo hunt.");
      setIsRunning(false);
      setStatus(reason);
    },
    [clearAssistantAudio, clearTimers, releaseMedia]
  );

  const sendAudioChunk = useCallback((samples: Float32Array, sampleRate: number) => {
    const socket = socketRef.current;
    if (!readyRef.current || socket?.readyState !== WebSocket.OPEN) return;
    const pcm = resampleToPcm16(samples, sampleRate, 16_000);
    socket.send(JSON.stringify({ type: "audio", data: int16ToBase64(pcm) }));
  }, []);

  const sendPhoneLocation = useCallback((location?: PhoneLocation) => {
    const socket = socketRef.current;
    if (!location || !readyRef.current || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "location", location }));
  }, []);

  const storePhoneLocation = useCallback(
    (position: GeolocationPosition) => {
      const location: PhoneLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      phoneLocationRef.current = location;
      setLocationStatus(`GPS ±${Math.round(position.coords.accuracy)}m`);
      sendPhoneLocation(location);
      return location;
    },
    [sendPhoneLocation]
  );

  const getInitialLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setLocationStatus("GPS unsupported by this browser");
      return undefined;
    }

    setLocationStatus("Getting initial GPS fix…");
    return new Promise<PhoneLocation | undefined>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(storePhoneLocation(position)),
        (error) => {
          setLocationStatus(locationErrorMessage(error));
          resolve(undefined);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
      );
    });
  }, [storePhoneLocation]);

  const startLocationWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("GPS unsupported");
      return;
    }
    if (locationWatchRef.current !== undefined) return;
    setLocationStatus("Requesting GPS…");
    locationWatchRef.current = navigator.geolocation.watchPosition(
      storePhoneLocation,
      (error) => {
        setLocationStatus(locationErrorMessage(error));
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 }
    );
  }, [storePhoneLocation]);

  const appendAudioSamples = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      audioSamplesRef.current.push(samples);
      audioSampleCountRef.current += samples.length;
      const samplesPerChunk = Math.round(sampleRate / 10);

      while (audioSampleCountRef.current >= samplesPerChunk) {
        const chunk = takeSamples(audioSamplesRef.current, samplesPerChunk);
        audioSampleCountRef.current -= samplesPerChunk;
        sendAudioChunk(chunk, sampleRate);
      }
    },
    [sendAudioChunk]
  );

  const queueAssistantAudio = useCallback((base64: string) => {
    if (mutedRef.current) return;
    const context = audioContextRef.current;
    if (!context) return;
    const samples = base64ToInt16(base64);
    if (!samples.length) return;

    const buffer = context.createBuffer(1, samples.length, 24_000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = samples[index] / 32_768;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.04, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + buffer.duration;
    audioSourcesRef.current.add(source);
    source.onended = () => audioSourcesRef.current.delete(source);
  }, []);

  const sendVideoFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const socket = socketRef.current;
    if (
      !readyRef.current ||
      !video ||
      !canvas ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !video.videoWidth
    ) {
      return;
    }

    const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    setLatestFrame(dataUrl);
    socket.send(JSON.stringify({ type: "video", data: dataUrl.split(",")[1] }));
  }, []);

  const sendLiveEvent = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const captureVisualStill = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return undefined;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1_280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.84);
  }, []);

  const startVisualTranslation = useCallback(
    async (requestedLanguage?: string) => {
      if (translationAbortRef.current) return;
      const imageDataUrl = captureVisualStill();
      if (!imageDataUrl) {
        setStatus("Start the camera first, then point it at the text you want translated.");
        return;
      }
      const language = requestedLanguage || targetLanguage || tripLanguage(activeTrip);
      setTargetLanguage(language);
      setShowOriginalTranslationImage(false);
      setTranslationModal({ originalImageDataUrl: imageDataUrl, targetLanguage: language, status: "working" });
      sendLiveEvent({ type: "visual-translation-started" });
      const controller = new AbortController();
      translationAbortRef.current = controller;

      try {
        const response = await fetch("/api/visual-translation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageDataUrl, targetLanguage: language }),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as TranslationResult & { error?: string };
        if (!response.ok || body.error) throw new Error(body.error || "Visual translation failed.");
        setTranslationModal({
          originalImageDataUrl: imageDataUrl,
          targetLanguage: language,
          status: body.status === "ready" ? "ready" : "fallback",
          result: body,
          message: body.fallbackMessage,
        });
        sendLiveEvent({ type: "visual-translation-finished", ok: body.status === "ready" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "Visual translation failed.";
        setTranslationModal({
          originalImageDataUrl: imageDataUrl,
          targetLanguage: language,
          status: "fallback",
          message,
        });
        sendLiveEvent({ type: "visual-translation-finished", ok: false });
      } finally {
        if (translationAbortRef.current === controller) translationAbortRef.current = undefined;
      }
    },
    [activeTrip, captureVisualStill, sendLiveEvent, targetLanguage]
  );

  const startCityGame = useCallback(
    async (requestedCity?: string) => {
      if (gameBusy) return;
      const city = (requestedCity || gameCity || activeTrip?.destinationCity || "").trim();
      if (!city) {
        setGameStatus("Choose a city or select a saved trip before starting a game.");
        return;
      }
      setGameBusy(true);
      setGameStatus(`Creating a public photo hunt for ${city}…`);
      try {
        const response = await fetch("/api/games/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city }),
        });
        const body = (await response.json().catch(() => ({}))) as { game?: CityGame; error?: string };
        if (!response.ok || !body.game) throw new Error(body.error || "Could not create a city game.");
        setGameCity(body.game.city);
        setCityGame(body.game);
        setGameStatus(`${body.game.targets.length} public visual targets are ready.`);
        sendLiveEvent({ type: "game-started" });
      } catch (error) {
        setGameStatus(error instanceof Error ? error.message : "Could not create a city game.");
      } finally {
        setGameBusy(false);
      }
    },
    [activeTrip?.destinationCity, gameBusy, gameCity, sendLiveEvent]
  );

  const captureGameTarget = useCallback(
    async (target: CityGameTarget) => {
      if (!cityGame || gameBusy) return;
      const imageDataUrl = captureVisualStill();
      if (!imageDataUrl) {
        setGameStatus("Start the camera first, then capture the target.");
        return;
      }
      setGameBusy(true);
      setGameStatus(`Checking ${target.title}…`);
      try {
        const response = await fetch("/api/games/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId: cityGame.gameId, targetId: target.id, imageDataUrl }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          completed?: boolean;
          confidence?: number;
          feedback?: string;
          game?: CityGame;
          error?: string;
        };
        if (!response.ok || !body.game) throw new Error(body.error || "Could not check that photo.");
        setCityGame(body.game);
        setGameStatus(body.feedback || (body.completed ? "Target completed." : "Try a clearer photo."));
        sendLiveEvent({ type: "game-progress", completed: Boolean(body.completed) });
      } catch (error) {
        setGameStatus(error instanceof Error ? error.message : "Could not check that photo.");
      } finally {
        setGameBusy(false);
      }
    },
    [captureVisualStill, cityGame, gameBusy, sendLiveEvent]
  );

  const closeTranslation = useCallback(() => {
    translationAbortRef.current?.abort();
    translationAbortRef.current = undefined;
    setTranslationModal(undefined);
  }, []);

  const beginTimers = useCallback(
    () => {
      frameTimerRef.current = window.setInterval(sendVideoFrame, 1000);
      sendVideoFrame();
    },
    [sendVideoFrame]
  );

  const handleSocketMessage = useCallback(
    (event: MessageEvent<string>) => {
      let message: SocketMessage;
      try {
        message = JSON.parse(event.data) as SocketMessage;
      } catch {
        setStatus("The laptop sent an unreadable WebSocket message.");
        return;
      }

      if (message.type === "connected") {
        setStatus("Connected to laptop; starting Gemini Live…");
        return;
      }
      if (message.type === "ready") {
        readyRef.current = true;
        sendPhoneLocation(phoneLocationRef.current);
        setIsRunning(true);
        setStatus(`Streaming to ${message.model}. Speak naturally and show the camera what you want examined.`);
        beginTimers();
        return;
      }
      if (message.type === "input-transcript") {
        setInputTranscript(message.text);
        return;
      }
      if (message.type === "output-transcript") {
        setOutputTranscript((previous) => mergeTranscript(previous, message.text, message.final));
        return;
      }
      if (message.type === "output-audio") {
        queueAssistantAudio(message.data);
        return;
      }
      if (message.type === "interrupted") {
        clearAssistantAudio();
        setStatus("Gemini response interrupted by new activity; listening.");
        return;
      }
      if (message.type === "tool-status") {
        setStatus(message.message);
        return;
      }
      if (message.type === "visual-translation-request") {
        void startVisualTranslation(message.targetLanguage);
        return;
      }
      if (message.type === "city-game-request") {
        void startCityGame(message.city);
        return;
      }
      if (message.type === "memory-status") {
        setMemoryStatus(message.message);
        return;
      }
      if (message.type === "location") {
        setLocationStatus(
          message.accuracy === null ? "GPS shared" : `GPS shared ±${Math.round(message.accuracy)}m`
        );
        return;
      }
      if (message.type === "metrics") {
        setMetrics({
          audioChunks: message.audioChunks,
          audioBytes: message.audioBytes,
          frames: message.frames,
          frameBytes: message.frameBytes,
        });
        return;
      }
      if (message.type === "error") {
        stopSession(`${message.code}: ${message.message}`);
        return;
      }
      if (message.type === "closed") {
        stopSession(message.reason);
      }
    },
    [beginTimers, clearAssistantAudio, queueAssistantAudio, sendPhoneLocation, startCityGame, startVisualTranslation, stopSession]
  );

  const startSession = useCallback(async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera and microphone require the HTTPS tunnel in a modern Android browser.");
      return;
    }

    try {
      setStatus("Getting a phone location before starting Gemini Live…");
      const initialLocation = await getInitialLocation();
      startLocationWatch();
      setStatus(
        initialLocation
          ? "Location acquired. Requesting rear camera and microphone permissions…"
          : "Location was not acquired. Continuing with camera and voice; Maps questions will show the GPS error below."
      );
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = media;
      setHasMedia(true);
      if (!videoRef.current) throw new Error("Camera preview is not available.");
      videoRef.current.srcObject = media;
      await videoRef.current.play();

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      await audioContext.audioWorklet.addModule("/live-audio-processor.js");
      const source = audioContext.createMediaStreamSource(media);
      const worklet = new AudioWorkletNode(audioContext, "lens-audio-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const silence = audioContext.createGain();
      silence.gain.value = 0;
      source.connect(worklet).connect(silence).connect(audioContext.destination);
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        appendAudioSamples(event.data, audioContext.sampleRate);
      };

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/live/realtime`);
      socketRef.current = socket;
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            type: "start",
            location: phoneLocationRef.current,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            trip: activeTrip,
            tripMemory,
          })
        );
      socket.onmessage = handleSocketMessage;
      socket.onerror = () => stopSession("The laptop WebSocket failed. Keep both the dev server and tunnel running.");
      socket.onclose = () => {
        if (socketRef.current === socket) {
          stopSession(readyRef.current ? "The laptop WebSocket closed." : "The laptop WebSocket closed before Gemini Live started.");
        }
      };
      setInputTranscript("");
      setOutputTranscript("");
      setMetrics(emptyMetrics);
      setLatestFrame(undefined);
      setStatus("Opening the secure connection to the laptop…");
    } catch (error) {
      stopSession(error instanceof Error ? error.message : "Could not start camera and microphone capture.");
    }
  }, [activeTrip, appendAudioSamples, getInitialLocation, handleSocketMessage, startLocationWatch, stopSession, tripMemory]);

  useEffect(() => {
    return () => {
      clearTimers();
      readyRef.current = false;
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
      releaseMedia();
      clearAssistantAudio();
    };
  }, [clearAssistantAudio, clearTimers, releaseMedia]);

  function selectTrip(value: string) {
    setActiveTrip(value);
    setActiveTripId(value);
    const trip = savedTrips.find((candidate) => candidate.id === value);
    if (trip) {
      setTargetLanguage(tripLanguage(trip));
      setGameCity(trip.destinationCity);
    }
    setMemoryStatus(
      trip
        ? `Memory updates will be saved to ${trip.destinationCity || "this trip"}.`
        : "Live remains available, but automatic memory updates are disabled."
    );
  }

  function toggleMute() {
    const nextMuted = !isMuted;
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    if (nextMuted) clearAssistantAudio();
  }

  return (
    <main className="min-h-screen bg-[#f4f5ef] px-4 py-5 text-[#17201a] sm:px-6">
      <div className="mx-auto grid max-w-3xl gap-4">
        <header className="rounded-xl bg-[#173f41] p-5 text-[#f7f8f0] shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-[#b8dfd9]">
            <Wifi size={17} /> Laptop WebSocket · Gemini Live test
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Camera + voice perception test</h1>
          <p className="mt-2 text-sm leading-6 text-[#d8e5df]">
            This test streams camera, microphone, and phone GPS to the laptop. Gemini can use Places, Routes, Weather, visual translation, and city-game tools without interrupting Live.
          </p>
        </header>

        <section className="rounded-xl border border-[#d7ded0] bg-[#fffef8] p-4 shadow-sm">
          <label className="grid gap-2 text-sm font-medium text-[#4f5b50]">
            Saved trip for memory
            <select
              className="h-11 rounded-md border border-[#cbd5c7] bg-white px-3 text-[#17201a] outline-none focus:border-[#2f6f73]"
              value={activeTripId}
              onChange={(event) => selectTrip(event.target.value)}
              disabled={isRunning}
            >
              <option value="">No saved trip (Live only)</option>
              {savedTrips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.destinationCity || "Untitled trip"} · {trip.dates || "dates not set"}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 grid gap-2 text-sm font-medium text-[#4f5b50]">
            Translate visuals into
            <select
              className="h-11 rounded-md border border-[#cbd5c7] bg-white px-3 text-[#17201a] outline-none focus:border-[#2f6f73]"
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
            >
              {translationLanguages.map((language) => (
                <option key={language} value={language}>{language}</option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="inline-flex h-11 items-center gap-2 rounded-md bg-[#2f6f73] px-4 font-medium text-white disabled:cursor-not-allowed disabled:bg-[#9eaaa0]"
              onClick={startSession}
              disabled={isRunning}
            >
              <Mic size={17} /> Start live test
            </button>
            <button
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[#cbd5c7] bg-white px-4 font-medium disabled:cursor-not-allowed disabled:text-[#9eaaa0]"
              onClick={() => stopSession("Stopped on phone.")}
              disabled={!isRunning && !hasMedia}
            >
              <Square size={16} /> Stop
            </button>
            <button
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[#cbd5c7] bg-white px-4 font-medium"
              onClick={toggleMute}
              aria-pressed={isMuted}
            >
              {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
              {isMuted ? "Speaker muted" : "Speaker on"}
            </button>
            <button
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[#2f6f73] bg-[#e7f1ef] px-4 font-medium text-[#1e5558] disabled:cursor-not-allowed disabled:border-[#cbd5c7] disabled:bg-[#f6f7f4] disabled:text-[#9eaaa0]"
              onClick={() => void startVisualTranslation()}
              disabled={!hasMedia || Boolean(translationModal && translationModal.status === "working")}
            >
              <Languages size={17} />
              {translationModal?.status === "working" ? "Translating" : "Translate lens"}
            </button>
          </div>
          <p className="mt-3 rounded-md border border-[#d7ded0] bg-[#f8faf4] p-3 text-sm text-[#4f5b50]">{status}</p>
          <p className="mt-2 text-xs text-[#667064]">Memory: {memoryStatus}</p>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#d7ded0] bg-[#101815] shadow-sm">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          {!hasMedia && (
            <div className="grid aspect-video place-items-center text-center text-[#d6ddd3]">
              <div>
                <Camera className="mx-auto mb-3" size={34} />
                <p className="text-sm">Start the test to grant camera and microphone access.</p>
              </div>
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </section>

        <section className="rounded-xl border border-[#d7ded0] bg-[#fffef8] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold"><Gamepad2 size={17} /> City game</div>
              <p className="mt-1 text-xs text-[#667064]">Safe public photo targets generated for a city. No purchases or people photos.</p>
            </div>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[#173f41] px-4 text-sm font-medium text-white disabled:cursor-wait disabled:bg-[#9eaaa0]"
              onClick={() => void startCityGame()}
              disabled={gameBusy}
            >
              <Gamepad2 size={16} /> {cityGame ? "New game" : "Start game"}
            </button>
          </div>
          <label className="mt-3 grid gap-1 text-sm font-medium text-[#4f5b50]">
            City
            <input
              className="h-10 rounded-md border border-[#cbd5c7] bg-white px-3 text-[#17201a] outline-none focus:border-[#2f6f73]"
              value={gameCity}
              onChange={(event) => setGameCity(event.target.value)}
              placeholder="e.g. Bengaluru, India"
              disabled={gameBusy}
            />
          </label>
          <p className="mt-3 rounded-md border border-[#d7ded0] bg-[#f8faf4] p-3 text-sm text-[#4f5b50]">{gameStatus}</p>
          {cityGame && (
            <div className="mt-3 grid gap-2">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>{cityGame.city} · {cityGame.targets.filter((target) => target.completed).length}/{cityGame.targets.length} found</span>
                <span>{cityGame.score} pts</span>
              </div>
              {cityGame.targets.map((target) => (
                <article key={target.id} className="rounded-lg border border-[#d7ded0] bg-white p-3">
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{target.completed ? "Found · " : ""}{target.title}</div>
                      <p className="mt-1 text-sm text-[#4f5b50]">{target.hint}</p>
                    </div>
                    <button
                      className="h-10 shrink-0 rounded-md border border-[#cbd5c7] px-3 text-sm font-medium disabled:cursor-not-allowed disabled:text-[#9eaaa0]"
                      onClick={() => void captureGameTarget(target)}
                      disabled={!hasMedia || target.completed || gameBusy}
                    >
                      {target.completed ? "Done" : "Capture"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Session" value={isRunning ? "streaming" : "idle"} />
          <Metric label="Camera frames" value={String(metrics.frames)} />
          <Metric label="Mic chunks" value={String(metrics.audioChunks)} />
          <Metric label="Camera sent" value={formatBytes(metrics.frameBytes)} />
          <Metric label="Audio sent" value={formatBytes(metrics.audioBytes)} />
          <Metric label="Location" value={locationStatus} />
          <Metric label="Memory" value={activeTrip ? memoryStatus : "not linked"} />
        </section>

        <section className="grid gap-4 rounded-xl border border-[#d7ded0] bg-[#fffef8] p-4 shadow-sm sm:grid-cols-[160px_1fr]">
          <div>
            <div className="text-sm font-semibold">Latest frame</div>
            {latestFrame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mt-3 aspect-square w-full rounded-md border border-[#d7ded0] object-cover" src={latestFrame} alt="Latest frame sent to Gemini" />
            ) : (
              <div className="mt-3 grid aspect-square place-items-center rounded-md border border-dashed border-[#cbd5c7] p-3 text-center text-xs text-[#667064]">No frame sent yet.</div>
            )}
          </div>
          <div className="grid content-start gap-3">
            <Transcript title="You said" value={inputTranscript} empty="Input transcription will appear while you speak." />
            <Transcript title="Gemini replied" value={outputTranscript} empty="Gemini’s spoken response will also appear here." />
          </div>
        </section>
        {translationModal && (
          <TranslationModal
            state={translationModal}
            showOriginal={showOriginalTranslationImage}
            onToggleOriginal={() => setShowOriginalTranslationImage((value) => !value)}
            onClose={closeTranslation}
          />
        )}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#d7ded0] bg-white p-3 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-[#667064]">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function Transcript({ title, value, empty }: { title: string; value: string; empty: string }) {
  return (
    <div className="rounded-md border border-[#d7ded0] bg-[#f8faf4] p-3 text-sm">
      <div className="font-medium">{title}</div>
      <p className="mt-1 whitespace-pre-wrap text-[#4f5b50]">{value || empty}</p>
    </div>
  );
}

function TranslationModal({
  state,
  showOriginal,
  onToggleOriginal,
  onClose,
}: {
  state: TranslationModalState;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onClose: () => void;
}) {
  const result = state.result;
  const image = showOriginal || !result?.editedImageDataUrl ? state.originalImageDataUrl : result.editedImageDataUrl;
  return (
    <section className="fixed inset-0 z-50 grid place-items-end bg-[#101815]/70 p-3 sm:place-items-center sm:p-6" aria-label="Visual translation">
      <div className="max-h-[94vh] w-full max-w-2xl overflow-auto rounded-2xl bg-[#fffef8] p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#1e5558]"><Languages size={17} /> Visual translation</div>
            <h2 className="mt-1 text-xl font-semibold">{state.status === "working" ? "Preparing your translated copy…" : `${result?.surfaceType || "Visual"} in ${state.targetLanguage}`}</h2>
          </div>
          <button className="rounded-full border border-[#cbd5c7] p-2" onClick={onClose} aria-label="Close translation">
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-sm text-[#4f5b50]">
          {state.status === "working"
            ? "Gemini is reading the visible text and rendering a faithful translated copy. Live voice and camera streaming continue in the background."
            : state.message || "AI-rendered translation. Check the original image for authoritative wording."}
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mt-4 max-h-[52vh] w-full rounded-xl border border-[#d7ded0] bg-[#101815] object-contain" src={image} alt="Translated or original visual" />
        {result?.editedImageDataUrl && (
          <button className="mt-3 rounded-md border border-[#cbd5c7] px-3 py-2 text-sm font-medium" onClick={onToggleOriginal}>
            {showOriginal ? "Show translated copy" : "Show original image"}
          </button>
        )}
        {result && (
          <div className="mt-4">
            <div className="text-sm font-semibold">Extracted translation</div>
            {result.textBlocks.length ? (
              <div className="mt-2 grid gap-2">
                {result.textBlocks.map((block, index) => (
                  <div key={`${index}-${block.source}`} className="rounded-lg border border-[#d7ded0] bg-[#f8faf4] p-3 text-sm">
                    <div className="text-[#667064]">{block.source}</div>
                    <div className="mt-1 font-medium">{block.translation}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[#667064]">No text was readable enough to translate. Try a closer, steadier frame.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const translationLanguages = [
  "English",
  "Hindi",
  "Kannada",
  "Tamil",
  "Telugu",
  "Japanese",
  "Korean",
  "French",
  "Spanish",
  "German",
  "Italian",
];

function tripLanguage(trip?: TripProfile) {
  const preferences = trip?.languagePreferences?.toLowerCase() ?? "";
  return translationLanguages.find((language) => preferences.includes(language.toLowerCase())) || "English";
}

function takeSamples(chunks: Float32Array[], targetLength: number) {
  const result = new Float32Array(targetLength);
  let offset = 0;
  while (offset < targetLength && chunks.length) {
    const chunk = chunks[0];
    const remaining = targetLength - offset;
    if (chunk.length <= remaining) {
      result.set(chunk, offset);
      offset += chunk.length;
      chunks.shift();
    } else {
      result.set(chunk.subarray(0, remaining), offset);
      chunks[0] = chunk.slice(remaining);
      offset += remaining;
    }
  }
  return result;
}

function resampleToPcm16(input: Float32Array, inputRate: number, outputRate: number) {
  const outputLength = Math.round((input.length * outputRate) / inputRate);
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = (index * inputRate) / outputRate;
    const lower = Math.floor(sourcePosition);
    const upper = Math.min(lower + 1, input.length - 1);
    const mix = sourcePosition - lower;
    const value = input[lower] * (1 - mix) + input[upper] * mix;
    output[index] = Math.max(-1, Math.min(1, value)) * 0x7fff;
  }
  return output;
}

function int16ToBase64(samples: Int16Array) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function base64ToInt16(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer);
}

function mergeTranscript(previous: string, next: string, isFinal: boolean) {
  if (!previous || isFinal) return previous ? `${previous}\n${next}` : next;
  return next;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function locationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "GPS denied for this tunnel site. Allow Location for the current trycloudflare.com page, then restart.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "GPS unavailable. Turn on device Location and move where the phone can get a fix.";
  }
  if (error.code === error.TIMEOUT) {
    return "GPS timed out. Keep Location on, wait for a signal, then restart the Live test.";
  }
  return `GPS error: ${error.message || "unknown location error"}`;
}
