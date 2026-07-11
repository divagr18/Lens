"use client";

import {
  AlertTriangle,
  Bot,
  Camera,
  CircleStop,
  FilePlus,
  Languages,
  MapPinned,
  MessageSquare,
  Mic,
  Navigation,
  Plane,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveTripToRegistry } from "@/lib/trip-registry";
import type { FormEvent, ReactNode } from "react";
import { defaultTrip } from "@/lib/travel-types";
import type {
  AddMemoryInput,
  ArtifactType,
  LiveObservation,
  LocationPreset,
  MapsContext,
  MemoryContext,
  MemorySource,
  NearbyPlace,
  TravelArtifact,
  TripProfile,
} from "@/lib/travel-types";
import { bengaluruLocationPresets } from "@/lib/travel-types";

type MemoryApiState = Partial<MemoryContext>;
type MapsApiState = {
  status: string;
  message: string;
};

type LiveMessage =
  | { type: "status"; status: string; transport?: string; timestamp?: number }
  | {
      type: "observation";
      observation: LiveObservation;
      memory: MemoryApiState;
    }
  | { type: "error"; error: string; observation?: LiveObservation };

const artifactTypes: Array<{ value: ArtifactType; label: string }> = [
  { value: "route_card", label: "Route" },
  { value: "menu_explainer", label: "Menu" },
  { value: "phrase_card", label: "Phrase" },
  { value: "booking_summary", label: "Booking" },
  { value: "etiquette_note", label: "Etiquette" },
  { value: "alert", label: "Alert" },
];

const memorySources: MemorySource[] = [
  "user-entered",
  "uploaded-document",
  "video-derived",
  "assistant-derived",
  "correction",
];

export default function Home() {
  const [trip, setTrip] = useState<TripProfile>(defaultTrip);
  const [memoryState, setMemoryState] = useState<MemoryApiState>({
    status: "not-configured",
    message: "Trip not saved yet.",
  });
  const [latestEvidence, setLatestEvidence] = useState<MemoryApiState>({
    status: "not-configured",
    message: "Ask a live question to see memory retrieval evidence.",
  });
  const [memoryDraft, setMemoryDraft] = useState(
    "Auto rickshaw price ceiling: avoid rides above Rs 350 unless it is raining or after 9 PM."
  );
  const [memorySource, setMemorySource] =
    useState<MemorySource>("user-entered");
  const [question, setQuestion] = useState(
    "Which way should I go from here, considering my itinerary?"
  );
  const [liveStatus, setLiveStatus] = useState("Idle");
  const [observations, setObservations] = useState<LiveObservation[]>([]);
  const [artifacts, setArtifacts] = useState<TravelArtifact[]>([]);
  const [artifactState, setArtifactState] = useState<MapsApiState>({
    status: "idle",
    message: "Save a trip, then create an Omni Flash visual card or Gemini text summary.",
  });
  const [artifactType, setArtifactType] =
    useState<ArtifactType>("route_card");
  const [artifactPrompt, setArtifactPrompt] = useState(
    "Make a route card from Indiranagar Metro to Cubbon Park with luggage."
  );
  const [originPresetId, setOriginPresetId] = useState("indiranagar-metro");
  const [destinationPresetId, setDestinationPresetId] = useState("cubbon-park");
  const [mapsContext, setMapsContext] = useState<MapsContext>();
  const [mapsState, setMapsState] = useState<MapsApiState>({
    status: "idle",
    message: "Refresh route context to add Maps data to live turns.",
  });
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frameDataUrl, setFrameDataUrl] = useState<string>();
  const [frameCount, setFrameCount] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const activeTrip = Boolean(trip.id);
  const latestObservation = observations[0];
  const originPreset = presetById(originPresetId);
  const destinationPreset = presetById(destinationPresetId);

  const connectionBadge = useMemo(() => {
    if (liveStatus.includes("connected")) return "ready";
    if (liveStatus.includes("processing")) return "working";
    if (liveStatus.includes("failed") || liveStatus.includes("error")) {
      return "error";
    }
    return "idle";
  }, [liveStatus]);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      socketRef.current?.close();
    };
  }, [videoUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || video.readyState < 2) return;
      captureFrame();
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  async function saveTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemoryState({ status: "working", message: "Saving trip memory..." });
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trip),
    });
    const body = (await res.json()) as {
      trip: TripProfile;
      memory: MemoryApiState;
    };
    setTrip(body.trip);
    saveTripToRegistry(body.trip);
    setMemoryState(body.memory);
  }

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTrip) {
      setMemoryState({ status: "error", message: "Save the trip first." });
      return;
    }
    const payload: AddMemoryInput & { trip: Omit<TripProfile, "id"> } = {
      content: memoryDraft,
      source: memorySource,
      tags: tagHints(memoryDraft),
      trip: {
        userId: trip.userId,
        destinationCity: trip.destinationCity,
        dates: trip.dates,
        hotel: trip.hotel,
        budget: trip.budget,
        dietaryRules: trip.dietaryRules,
        mobilityAndLuggage: trip.mobilityAndLuggage,
        languagePreferences: trip.languagePreferences,
        itinerary: trip.itinerary,
      },
    };

    const res = await fetch(`/api/trips/${trip.id}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { memory: MemoryApiState };
    setMemoryState(body.memory);
  }

  function onVideoFile(file?: File) {
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setFrameDataUrl(undefined);
    setFrameCount(0);
    setLastFrameAt(0);
  }

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    const size = 768;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, size, size);

    const scale = Math.min(size / video.videoWidth, size / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    const x = (size - width) / 2;
    const y = (size - height) / 2;
    ctx.drawImage(video, x, y, width, height);

    setFrameDataUrl(canvas.toDataURL("image/jpeg", 0.78));
    setFrameCount((count) => count + 1);
    setLastFrameAt(video.currentTime);
  }

  function ensureSocket() {
    return new Promise<WebSocket>((resolve, reject) => {
      const existing = socketRef.current;
      if (existing?.readyState === WebSocket.OPEN) {
        resolve(existing);
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/live`);
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error("WebSocket connection timed out."));
      }, 1200);
      socketRef.current = socket;
      socket.onopen = () => {
        window.clearTimeout(timeout);
        resolve(socket);
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("WebSocket connection failed."));
      };
      socket.onmessage = (event) => handleLiveMessage(JSON.parse(event.data));
    });
  }

  function handleLiveMessage(message: LiveMessage) {
    if (message.type === "status") {
      setLiveStatus(`${message.status}${message.transport ? ` via ${message.transport}` : ""}`);
      return;
    }
    if (message.type === "error") {
      setLiveStatus(message.error);
      if (message.observation) {
        setObservations((items) => [message.observation!, ...items]);
      }
      return;
    }

    setLiveStatus(
      `${message.observation.status} via ${message.observation.transport}`
    );
    setMemoryState(message.memory);
    setLatestEvidence(message.memory);
    setObservations((items) => [message.observation, ...items]);
  }

  async function sendLiveTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTrip) {
      setLiveStatus("Save the trip first.");
      return;
    }
    setLiveStatus("connecting");
    const payload = {
      type: "observation" as const,
      tripId: trip.id,
      userId: trip.userId,
      question,
      timestamp: videoRef.current?.currentTime ?? lastFrameAt,
      frameDataUrl,
      routeContext: mapsContext,
    };

    try {
      const socket = await ensureSocket();
      socket.send(JSON.stringify(payload));
    } catch {
      setLiveStatus("WebSocket unavailable; using HTTP live turn.");
      const res = await fetch("/api/live/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        observation: LiveObservation;
        memory: MemoryApiState;
      };
      handleLiveMessage({ type: "observation", ...body });
    }
  }

  async function createArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTrip) {
      setArtifactState({
        status: "not-configured",
        message: "Save the trip first so the artifact can attach to a trip id.",
      });
      return;
    }

    const pendingId = crypto.randomUUID();
    const pendingArtifact: TravelArtifact = {
      id: pendingId,
      type: artifactType,
      title: `Creating ${artifactLabel(artifactType).toLowerCase()}`,
      body: artifactTargetMessage(artifactType),
      status: "working",
      runtime: artifactRuntime(artifactType),
      createdAt: new Date().toISOString(),
    };

    setArtifactState({
      status: "working",
      message: artifactTargetMessage(artifactType),
    });
    setArtifacts((items) => [pendingArtifact, ...items]);

    try {
      const res = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: trip.id,
          type: artifactType,
          prompt: artifactPrompt,
          context: latestObservation?.assistantAnswer,
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const body = (await res.json()) as { artifact: TravelArtifact };
      setArtifacts((items) =>
        items.map((item) => (item.id === pendingId ? body.artifact : item))
      );
      setArtifactState({
        status: body.artifact.status,
        message: body.artifact.body,
      });
    } catch (error) {
      const errorArtifact: TravelArtifact = {
        id: pendingId,
        type: artifactType,
        title: "Artifact creation failed",
        body:
          error instanceof Error
            ? error.message
            : "The artifact API failed without a readable error.",
        status: "error",
        runtime: artifactRuntime(artifactType),
        createdAt: new Date().toISOString(),
      };
      setArtifacts((items) =>
        items.map((item) => (item.id === pendingId ? errorArtifact : item))
      );
      setArtifactState({
        status: "error",
        message: errorArtifact.body,
      });
    }
  }

  async function refreshMapsContext() {
    setMapsState({ status: "working", message: "Fetching route context..." });
    try {
      const res = await fetch("/api/maps/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: originPreset,
          destination: destinationPreset,
          travelMode: "TRANSIT",
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const body = (await res.json()) as { mapsContext: MapsContext };
      setMapsContext(body.mapsContext);
      setMapsState({
        status: body.mapsContext.evidence.status,
        message:
          body.mapsContext.evidence.errors[0] ||
          `${body.mapsContext.route.durationText}, ${body.mapsContext.route.distanceText}`,
      });
    } catch (error) {
      setMapsState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Maps context refresh failed.",
      });
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f7f4] text-[#17201a]">
      <header className="border-b border-[#d7ded0] bg-[#fffef8]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-[#243b35] text-white">
              <Plane size={21} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Lens Travel Cockpit</h1>
              <p className="text-sm text-[#667064]">
                India city travel - PC replay prototype
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill label="Memory" value={memoryState.status || "idle"} />
            <StatusPill label="Maps" value={mapsState.status} />
            <StatusPill label="Live" value={connectionBadge} />
            <StatusPill
              label="Frames"
              value={`${frameCount} captured`}
              muted
            />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-4 px-5 py-5 xl:grid-cols-[360px_minmax(460px,1fr)_390px]">
        <section className="rounded-lg border border-[#d7ded0] bg-[#fffef8] p-4">
          <PanelTitle icon={<Save size={18} />} title="Trip Setup" />
          <form className="mt-4 grid gap-3" onSubmit={saveTrip}>
            <Field
              label="User"
              value={trip.userId}
              onChange={(userId) => setTrip({ ...trip, userId })}
            />
            <Field
              label="City"
              value={trip.destinationCity}
              onChange={(destinationCity) =>
                setTrip({ ...trip, destinationCity })
              }
            />
            <Field
              label="Dates"
              value={trip.dates}
              onChange={(dates) => setTrip({ ...trip, dates })}
            />
            <Field
              label="Hotel"
              value={trip.hotel}
              onChange={(hotel) => setTrip({ ...trip, hotel })}
            />
            <Field
              label="Budget"
              value={trip.budget}
              onChange={(budget) => setTrip({ ...trip, budget })}
            />
            <TextField
              label="Diet"
              value={trip.dietaryRules}
              onChange={(dietaryRules) => setTrip({ ...trip, dietaryRules })}
            />
            <TextField
              label="Constraints"
              value={trip.mobilityAndLuggage}
              onChange={(mobilityAndLuggage) =>
                setTrip({ ...trip, mobilityAndLuggage })
              }
            />
            <Field
              label="Languages"
              value={trip.languagePreferences}
              onChange={(languagePreferences) =>
                setTrip({ ...trip, languagePreferences })
              }
            />
            <TextField
              label="Itinerary"
              value={trip.itinerary}
              onChange={(itinerary) => setTrip({ ...trip, itinerary })}
            />
            <button
              type="submit"
              data-testid="save-trip"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#243b35] px-4 text-sm font-medium text-white hover:bg-[#315048]"
            >
              <Save size={16} />
              Save trip
            </button>
          </form>

          <form className="mt-5 grid gap-3 border-t border-[#d7ded0] pt-4" onSubmit={addMemory}>
            <PanelTitle icon={<FilePlus size={18} />} title="Add Memory" />
            <select
              className="h-10 rounded-md border border-[#cbd5c7] bg-white px-3 text-sm outline-none focus:border-[#2f6f73]"
              value={memorySource}
              onChange={(event) =>
                setMemorySource(event.target.value as MemorySource)
              }
            >
              {memorySources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <textarea
              className="min-h-24 resize-y rounded-md border border-[#cbd5c7] bg-white px-3 py-2 text-sm outline-none focus:border-[#2f6f73]"
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
            />
            <button
              type="submit"
              data-testid="store-memory"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#2f6f73] px-4 text-sm font-medium text-[#1e5558] hover:bg-[#e7f1ef]"
            >
              <FilePlus size={16} />
              Store memory
            </button>
          </form>

          <StatusBlock state={memoryState} />
        </section>

        <section className="rounded-lg border border-[#d7ded0] bg-[#fffef8] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PanelTitle icon={<Camera size={18} />} title="Video Replay" />
            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#cbd5c7] bg-white px-3 text-sm font-medium hover:bg-[#f1f4ec]">
              <Upload size={16} />
              Upload clip
              <input
                className="sr-only"
                type="file"
                accept="video/*"
                onChange={(event) => onVideoFile(event.target.files?.[0])}
              />
            </label>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg bg-[#101815]">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="aspect-video w-full bg-black object-contain"
                controls
                onLoadedData={captureFrame}
                onSeeked={captureFrame}
              />
            ) : (
              <div className="grid aspect-video place-items-center text-center text-[#d6ddd3]">
                <div>
                  <Play className="mx-auto mb-3" size={34} />
                  <p className="text-sm">Upload a vlog, station, menu, or street clip.</p>
                </div>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />

          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Metric label="Timestamp" value={`${lastFrameAt.toFixed(1)}s`} />
            <Metric label="Sampling" value="1 FPS" />
            <Metric label="Frame" value={frameDataUrl ? "ready" : "empty"} />
          </div>

          {frameDataUrl && (
            <div className="mt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Latest captured replay frame"
                src={frameDataUrl}
                className="h-36 w-36 rounded-md border border-[#d7ded0] object-cover"
              />
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[#d7ded0] bg-[#fffef8] p-4">
          <PanelTitle icon={<MessageSquare size={18} />} title="Live Assistant" />
          <form className="mt-4 grid gap-3" onSubmit={sendLiveTurn}>
            <textarea
              className="min-h-28 resize-y rounded-md border border-[#cbd5c7] bg-white px-3 py-2 text-sm outline-none focus:border-[#2f6f73]"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="submit"
                data-testid="ask-live"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#2f6f73] px-4 text-sm font-medium text-white hover:bg-[#285f62]"
              >
                <Mic size={16} />
                Ask on frame
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#cbd5c7] px-4 text-sm font-medium hover:bg-[#f1f4ec]"
                onClick={() => socketRef.current?.close()}
              >
                <CircleStop size={16} />
                Close
              </button>
            </div>
          </form>

          <div className="mt-4 rounded-md border border-[#d7ded0] bg-[#f8faf4] p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <Bot size={16} />
              {liveStatus}
            </div>
            <p className="whitespace-pre-wrap text-[#4f5b50]">
              {latestObservation?.assistantAnswer ||
                "Answers will appear here after a live turn."}
            </p>
          </div>

          <div className="mt-4 grid max-h-[360px] gap-3 overflow-auto pr-1">
            {observations.map((item) => (
              <article
                key={item.id}
                className="rounded-md border border-[#d7ded0] bg-white p-3 text-sm"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-medium">{item.timestamp.toFixed(1)}s</span>
                  <span className="rounded bg-[#e4ede8] px-2 py-1 text-xs">
                    {item.transport}
                  </span>
                </div>
                <p className="text-[#4f5b50]">{item.userUtterance}</p>
                <p className="mt-2 whitespace-pre-wrap">{item.assistantAnswer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-[#d7ded0] bg-[#fffef8] p-4 xl:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PanelTitle icon={<Navigation size={18} />} title="Location + Route Context" />
            <button
              type="button"
              data-testid="refresh-maps-context"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#2f6f73] px-4 text-sm font-medium text-white hover:bg-[#285f62]"
              onClick={refreshMapsContext}
            >
              <RefreshCw size={16} />
              Refresh route context
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[280px_280px_1fr]">
            <label className="grid gap-1 text-sm font-medium text-[#4f5b50]">
              Current location
              <select
                className="h-10 rounded-md border border-[#cbd5c7] bg-white px-3 text-[#17201a] outline-none focus:border-[#2f6f73]"
                value={originPresetId}
                onChange={(event) => setOriginPresetId(event.target.value)}
              >
                {bengaluruLocationPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-[#4f5b50]">
              Destination
              <select
                className="h-10 rounded-md border border-[#cbd5c7] bg-white px-3 text-[#17201a] outline-none focus:border-[#2f6f73]"
                value={destinationPresetId}
                onChange={(event) => setDestinationPresetId(event.target.value)}
              >
                {bengaluruLocationPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-md border border-[#d7ded0] bg-[#f8faf4] p-3 text-sm">
              <div className="mb-1 font-medium">{mapsState.status}</div>
              <p className="text-[#4f5b50]">{mapsState.message}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
            <RouteSummary context={mapsContext} />
            <NearbySummary places={mapsContext?.nearbyPlaces ?? []} />
          </div>
        </section>

        <section className="rounded-lg border border-[#d7ded0] bg-[#fffef8] p-4 xl:col-span-3">
          <PanelTitle icon={<Bot size={18} />} title="Memory Evidence" />
          <div className="mt-4 grid gap-3 lg:grid-cols-[320px_1fr_1fr]">
            <div className="rounded-md border border-[#d7ded0] bg-[#f8faf4] p-3 text-sm">
              <div className="mb-2 font-medium">Retrieval status</div>
              <dl className="grid gap-2 text-[#4f5b50]">
                <EvidenceRow label="Status" value={latestEvidence.status || "idle"} />
                <EvidenceRow
                  label="Available"
                  value={latestEvidence.available ? "yes" : "no"}
                />
                <EvidenceRow
                  label="Query"
                  value={latestEvidence.query || "No live query yet."}
                />
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {(latestEvidence.containerTags ?? [
                  `user:${trip.userId}`,
                  trip.id ? `trip:${trip.id}` : "trip:not-saved",
                  "city:india",
                ]).map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-[#e4ede8] px-2 py-1 text-xs text-[#1e5558]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <EvidenceList
              title="Profile facts"
              empty="No Supermemory profile facts returned yet."
              items={[
                ...(latestEvidence.profileStatic ?? []),
                ...(latestEvidence.profileDynamic ?? []),
              ]}
            />
            <EvidenceList
              title="Memory snippets"
              empty={latestEvidence.message || "No memory snippets returned yet."}
              items={latestEvidence.memories ?? []}
            />
            <EvidenceList
              title="Maps context"
              empty="Refresh route context to show Maps evidence."
              items={mapsEvidenceItems(mapsContext)}
            />
          </div>
        </section>

        <section className="rounded-lg border border-[#d7ded0] bg-[#fffef8] p-4 xl:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PanelTitle icon={<Sparkles size={18} />} title="Travel Cards" />
            <form className="flex flex-wrap items-center gap-2" onSubmit={createArtifact}>
              <select
                className="h-10 rounded-md border border-[#cbd5c7] bg-white px-3 text-sm outline-none focus:border-[#2f6f73]"
                value={artifactType}
                onChange={(event) =>
                  setArtifactType(event.target.value as ArtifactType)
                }
              >
                {artifactTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <input
                className="h-10 min-w-[320px] rounded-md border border-[#cbd5c7] bg-white px-3 text-sm outline-none focus:border-[#2f6f73]"
                value={artifactPrompt}
                onChange={(event) => setArtifactPrompt(event.target.value)}
              />
              <button
                type="submit"
                data-testid="create-artifact"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#7b3f2a] px-4 text-sm font-medium text-white hover:bg-[#673423] disabled:cursor-wait disabled:opacity-70"
                disabled={artifactState.status === "working"}
              >
                <Sparkles size={16} />
                {artifactState.status === "working" ? "Creating" : "Create"}
              </button>
            </form>
          </div>
          <StatusBlock state={artifactState} />

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {artifacts.length === 0 ? (
              <EmptyCard />
            ) : (
              artifacts.map((artifact) => (
                <article
                  key={artifact.id}
                  className="rounded-lg border border-[#d7ded0] bg-white p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {artifactIcon(artifact.type)}
                      <h3 className="font-semibold">{artifact.title}</h3>
                    </div>
                    <span className="rounded bg-[#f1e6df] px-2 py-1 text-xs text-[#703821]">
                      {artifact.status}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-[#4f5b50]">
                    {artifact.body}
                  </p>
                  <ArtifactMedia artifact={artifact} />
                  <div className="mt-3 rounded border border-[#e1e6dc] bg-[#fbfcf8] px-2 py-1 text-xs text-[#667064]">
                    Runtime: {artifact.runtime}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-base font-semibold">
      <span className="text-[#2f6f73]">{icon}</span>
      {title}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-[#4f5b50]">
      {label}
      <input
        className="h-10 rounded-md border border-[#cbd5c7] bg-white px-3 text-[#17201a] outline-none focus:border-[#2f6f73]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-[#4f5b50]">
      {label}
      <textarea
        className="min-h-20 resize-y rounded-md border border-[#cbd5c7] bg-white px-3 py-2 text-[#17201a] outline-none focus:border-[#2f6f73]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function StatusPill({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`rounded-md border px-3 py-1 ${
        muted
          ? "border-[#d7ded0] bg-[#f6f7f4] text-[#667064]"
          : "border-[#b9d2d0] bg-[#e7f1ef] text-[#1e5558]"
      }`}
    >
      {label}: {value}
    </span>
  );
}

function StatusBlock({ state }: { state: { status?: string; message?: string } }) {
  return (
    <div className="mt-4 rounded-md border border-[#d7ded0] bg-[#f8faf4] p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium">
        <AlertTriangle size={16} />
        {state.status || "idle"}
      </div>
      <p className="text-[#4f5b50]">{state.message || "No status yet."}</p>
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-[#667064]">{label}</dt>
      <dd className="mt-0.5 break-words text-[#17201a]">{value}</dd>
    </div>
  );
}

function EvidenceList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: string[];
}) {
  return (
    <div className="rounded-md border border-[#d7ded0] bg-white p-3 text-sm">
      <div className="mb-2 font-medium">{title}</div>
      {items.length > 0 ? (
        <ul className="grid max-h-56 gap-2 overflow-auto pr-1">
          {items.map((item, index) => (
            <li
              key={`${title}-${index}-${item.slice(0, 12)}`}
              className="rounded border border-[#e1e6dc] bg-[#fbfcf8] p-2 text-[#4f5b50]"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[#667064]">{empty}</p>
      )}
    </div>
  );
}

function RouteSummary({ context }: { context?: MapsContext }) {
  if (!context) {
    return (
      <div className="rounded-md border border-dashed border-[#cbd5c7] bg-white p-4 text-sm text-[#667064]">
        <div className="mb-2 flex items-center gap-2 font-medium text-[#17201a]">
          <Navigation size={17} />
          Route not loaded
        </div>
        Choose Bengaluru presets and refresh route context.
      </div>
    );
  }

  const route = context.route;
  return (
    <article className="rounded-md border border-[#d7ded0] bg-white p-4 text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">
          {route.origin.label} to {route.destination.label}
        </div>
        <span className="rounded bg-[#e4ede8] px-2 py-1 text-xs text-[#1e5558]">
          {route.source}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Mode" value={`${route.travelMode}${route.usedFallback ? " fallback" : ""}`} />
        <Metric label="ETA" value={route.durationText} />
        <Metric label="Distance" value={route.distanceText} />
      </div>
      <div className="mt-3 rounded border border-[#e1e6dc] bg-[#fbfcf8] p-3">
        <div className="text-xs uppercase text-[#667064]">Next step</div>
        <p className="mt-1 text-[#17201a]">{route.nextStep}</p>
      </div>
      {route.steps.length > 0 && (
        <ol className="mt-3 grid max-h-52 gap-2 overflow-auto pr-1">
          {route.steps.map((step, index) => (
            <li
              key={`${index}-${step.instruction}`}
              className="rounded border border-[#e1e6dc] bg-[#fbfcf8] p-2"
            >
              <div className="font-medium">
                {index + 1}. {step.instruction}
              </div>
              <div className="mt-1 text-xs text-[#667064]">
                {[step.travelMode, step.durationText, step.distanceText]
                  .filter(Boolean)
                  .join(" - ")}
              </div>
              {step.transit && (
                <div className="mt-1 text-xs text-[#4f5b50]">
                  {[step.transit.lineName, step.transit.headsign]
                    .filter(Boolean)
                    .join(" toward ")}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {route.warnings.length > 0 && (
        <p className="mt-3 text-xs text-[#7b3f2a]">{route.warnings.join(" ")}</p>
      )}
    </article>
  );
}

function NearbySummary({ places }: { places: NearbyPlace[] }) {
  return (
    <article className="rounded-md border border-[#d7ded0] bg-white p-4 text-sm">
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <MapPinned size={17} />
        Nearby places
      </div>
      {places.length > 0 ? (
        <div className="grid max-h-80 gap-2 overflow-auto pr-1">
          {places.map((place) => (
            <div
              key={place.id}
              className="rounded border border-[#e1e6dc] bg-[#fbfcf8] p-2"
            >
              <div className="font-medium">{place.displayName}</div>
              <div className="mt-1 text-xs text-[#667064]">
                {place.types.slice(0, 4).join(", ") || "type unavailable"}
              </div>
              {place.formattedAddress && (
                <div className="mt-1 text-xs text-[#4f5b50]">
                  {place.formattedAddress}
                </div>
              )}
              {place.googleMapsUrl && (
                <a
                  className="mt-2 inline-block text-xs font-medium text-[#1e5558] underline"
                  href={place.googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Google Maps
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[#667064]">Nearby places will appear after refresh.</p>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#d7ded0] bg-[#f8faf4] p-3">
      <div className="text-xs text-[#667064]">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function EmptyCard() {
  return (
    <article className="rounded-lg border border-dashed border-[#cbd5c7] bg-white p-4 text-sm text-[#667064]">
      <div className="mb-2 flex items-center gap-2 font-medium text-[#17201a]">
        <Languages size={17} />
        No artifact yet
      </div>
      Create an Omni Flash visual card or a Gemini 3.5 Flash text summary after saving a trip.
    </article>
  );
}

function ArtifactMedia({ artifact }: { artifact: TravelArtifact }) {
  if (artifact.media?.kind !== "video") return null;
  const source = artifact.media.dataUrl || artifact.media.uri;
  if (!source) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-[#d7ded0] bg-[#101815]">
      <video
        className="aspect-[9/16] max-h-[420px] w-full bg-black object-contain"
        controls
        src={source}
      />
      <div className="border-t border-[#2d3834] px-3 py-2 text-xs text-[#d6ddd3]">
        {artifact.media.model}
        {artifact.media.interactionId ? ` - ${artifact.media.interactionId}` : ""}
      </div>
    </div>
  );
}

function artifactLabel(type: ArtifactType) {
  return artifactTypes.find((artifact) => artifact.value === type)?.label ?? "Artifact";
}

function artifactRuntime(type: ArtifactType): TravelArtifact["runtime"] {
  return type === "booking_summary" ? "gemini-3.5-flash" : "gemini-omni-flash";
}

function artifactTargetMessage(type: ArtifactType) {
  if (type === "booking_summary") {
    return "Sending booking summary to Gemini 3.5 Flash.";
  }
  return "Sending visual travel card request to Gemini Omni Flash. This can take a little while.";
}

function artifactIcon(type: ArtifactType) {
  const className = "text-[#2f6f73]";
  if (type === "route_card") return <MapPinned className={className} size={18} />;
  if (type === "menu_explainer") {
    return <AlertTriangle className={className} size={18} />;
  }
  if (type === "phrase_card") return <Languages className={className} size={18} />;
  return <Sparkles className={className} size={18} />;
}

function tagHints(content: string) {
  const lower = content.toLowerCase();
  const tags = new Set<string>();
  if (lower.includes("food") || lower.includes("vegetarian")) tags.add("food");
  if (lower.includes("hotel") || lower.includes("booking")) tags.add("booking");
  if (lower.includes("route") || lower.includes("metro")) tags.add("route");
  if (lower.includes("avoid") || lower.includes("ceiling")) tags.add("constraint");
  return [...tags];
}

function presetById(id: string): LocationPreset {
  return (
    bengaluruLocationPresets.find((preset) => preset.id === id) ??
    bengaluruLocationPresets[0]
  );
}

function mapsEvidenceItems(context?: MapsContext) {
  if (!context) return [];
  return [
    `Status: ${context.evidence.status}`,
    `Route query: ${context.evidence.routeQuery}`,
    `Route field mask: ${context.evidence.routeFieldMask}`,
    `Nearby query: ${context.evidence.nearbyQuery}`,
    `Source: ${context.evidence.source}`,
    ...context.evidence.errors.map((error) => `Error: ${error}`),
  ];
}
