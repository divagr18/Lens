"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TripProfile } from "@/lib/travel-types";
import { useMagellanStore } from "./store";

type PhoneLocation = { lat: number; lng: number; accuracy?: number };

type SocketMessage =
  | { type: "connected"; transport: string }
  | { type: "ready"; model: string; maxDurationMs: number }
  | { type: "input-transcript"; text: string; final: boolean }
  | { type: "output-transcript"; text: string; final: boolean }
  | { type: "output-audio"; data: string }
  | { type: "interrupted" }
  | { type: "tool-status"; message: string }
  | { type: "memory-status"; message: string }
  | { type: "error"; code: string; message: string }
  | { type: "closed"; reason: string };

export function useLensLiveSession({
  trip,
  facingMode,
  videoRef,
}: {
  trip?: TripProfile;
  facingMode: "user" | "environment";
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [status, setStatus] = useState("Start the camera to connect to Gemini Live.");
  const [isReady, setIsReady] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream>();
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextPlaybackTimeRef = useRef(0);
  const frameTimerRef = useRef<number | undefined>(undefined);
  const locationWatchRef = useRef<number | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const audioSamplesRef = useRef<Float32Array[]>([]);
  const audioSampleCountRef = useRef(0);
  const readyRef = useRef(false);
  const setConnected = useMagellanStore((state) => state.setConnected);
  const setVoiceActive = useMagellanStore((state) => state.setVoiceActive);
  const setLiveTranscription = useMagellanStore((state) => state.setLiveTranscription);
  const addMessage = useMagellanStore((state) => state.addMessage);
  const setIsGenerating = useMagellanStore((state) => state.setIsGenerating);

  const clearAssistantAudio = useCallback(() => {
    audioSourcesRef.current.forEach((source) => source.stop());
    audioSourcesRef.current.clear();
    nextPlaybackTimeRef.current = audioContextRef.current?.currentTime ?? 0;
  }, []);

  const releaseMedia = useCallback(() => {
    if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
    frameTimerRef.current = undefined;
    if (locationWatchRef.current !== undefined) navigator.geolocation?.clearWatch(locationWatchRef.current);
    locationWatchRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMediaStream(undefined);
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
    audioSamplesRef.current = [];
    audioSampleCountRef.current = 0;
  }, []);

  const stop = useCallback(
    (reason = "Live session stopped.") => {
      readyRef.current = false;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
      socket?.close();
      clearAssistantAudio();
      releaseMedia();
      setConnected(false);
      setVoiceActive(false);
      setIsGenerating(false);
      setIsReady(false);
      setStatus(reason);
    },
    [clearAssistantAudio, releaseMedia, setConnected, setIsGenerating, setVoiceActive]
  );

  const sendJson = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const queueAssistantAudio = useCallback((base64: string) => {
    const context = audioContextRef.current;
    if (!context || useMagellanStore.getState().isMuted) return;
    const samples = base64ToInt16(base64);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, 24_000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32_768;
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
    if (!readyRef.current || !video?.videoWidth) return;
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    sendJson({ type: "video", data: canvas.toDataURL("image/jpeg", 0.72).split(",")[1] });
  }, [sendJson, videoRef]);

  const sendAudioChunk = useCallback((samples: Float32Array, sampleRate: number) => {
    if (!readyRef.current) return;
    sendJson({ type: "audio", data: int16ToBase64(resampleToPcm16(samples, sampleRate, 16_000)) });
  }, [sendJson]);

  const appendAudioSamples = useCallback((samples: Float32Array, sampleRate: number) => {
    audioSamplesRef.current.push(samples);
    audioSampleCountRef.current += samples.length;
    const targetLength = Math.round(sampleRate / 10);
    while (audioSampleCountRef.current >= targetLength) {
      const chunk = takeSamples(audioSamplesRef.current, targetLength);
      audioSampleCountRef.current -= targetLength;
      sendAudioChunk(chunk, sampleRate);
    }
  }, [sendAudioChunk]);

  const handleSocketMessage = useCallback((event: MessageEvent<string>) => {
    let message: SocketMessage;
    try {
      message = JSON.parse(event.data) as SocketMessage;
    } catch {
      setStatus("The laptop sent an unreadable Live message.");
      return;
    }
    if (message.type === "connected") {
      setStatus("Connected to laptop; starting Gemini Live…");
      return;
    }
    if (message.type === "ready") {
      readyRef.current = true;
      setIsReady(true);
      setConnected(true);
      setVoiceActive(true);
      setStatus(`Live with ${message.model}. Speak naturally and show the camera what matters.`);
      sendVideoFrame();
      frameTimerRef.current = window.setInterval(sendVideoFrame, 1_000);
      return;
    }
    if (message.type === "input-transcript") {
      setLiveTranscription(message.text);
      return;
    }
    if (message.type === "output-transcript") {
      if (message.final && message.text.trim()) {
        addMessage({ id: crypto.randomUUID(), role: "assistant", content: message.text });
        setIsGenerating(false);
      }
      return;
    }
    if (message.type === "output-audio") {
      queueAssistantAudio(message.data);
      return;
    }
    if (message.type === "interrupted") {
      clearAssistantAudio();
      setStatus("Gemini was interrupted and is listening again.");
      return;
    }
    if (message.type === "tool-status" || message.type === "memory-status") {
      setStatus(message.message);
      return;
    }
    if (message.type === "error") {
      stop(`${message.code}: ${message.message}`);
      return;
    }
    if (message.type === "closed") stop(message.reason);
  }, [addMessage, clearAssistantAudio, queueAssistantAudio, sendVideoFrame, setConnected, setIsGenerating, setLiveTranscription, setVoiceActive, stop]);

  const start = useCallback(async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera and microphone require the HTTPS tunnel in a modern Android browser.");
      return false;
    }
    try {
      setStatus("Requesting camera, microphone, and location…");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setMediaStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const context = new AudioContext();
      audioContextRef.current = context;
      await context.resume();
      await context.audioWorklet.addModule("/live-audio-processor.js");
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "lens-audio-capture");
      const silence = context.createGain();
      silence.gain.value = 0;
      source.connect(worklet).connect(silence).connect(context.destination);
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => appendAudioSamples(event.data, context.sampleRate);

      const location = await getCurrentLocation();
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/live/realtime`);
      socketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({
        type: "start",
        location,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        trip,
      }));
      socket.onmessage = handleSocketMessage;
      socket.onerror = () => stop("The Lens Live WebSocket failed.");
      socket.onclose = () => {
        if (socketRef.current === socket) stop(readyRef.current ? "The Lens Live WebSocket closed." : "The Lens Live WebSocket closed before startup.");
      };
      if (navigator.geolocation) {
        locationWatchRef.current = navigator.geolocation.watchPosition(
          (position) => sendJson({ type: "location", location: positionToLocation(position) }),
          () => undefined,
          { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 }
        );
      }
      return true;
    } catch (error) {
      stop(error instanceof Error ? error.message : "Could not start the Lens Live session.");
      return false;
    }
  }, [appendAudioSamples, facingMode, handleSocketMessage, sendJson, stop, trip, videoRef]);

  const sendText = useCallback((text: string) => {
    if (!readyRef.current || !text.trim()) return false;
    setIsGenerating(true);
    sendJson({ type: "text", text: text.trim() });
    return true;
  }, [sendJson, setIsGenerating]);

  useEffect(() => () => stop("Live view closed."), [stop]);

  return {
    status,
    isReady,
    mediaStream,
    start,
    stop,
    sendText,
  };
}

function getCurrentLocation() {
  if (!navigator.geolocation) return Promise.resolve<PhoneLocation | undefined>(undefined);
  return new Promise<PhoneLocation | undefined>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(positionToLocation(position)),
      () => resolve(undefined),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );
  });
}

function positionToLocation(position: GeolocationPosition): PhoneLocation {
  return { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
}

function takeSamples(chunks: Float32Array[], length: number) {
  const result = new Float32Array(length);
  let offset = 0;
  while (offset < length && chunks.length) {
    const chunk = chunks[0];
    const remaining = length - offset;
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
  const output = new Int16Array(Math.round((input.length * outputRate) / inputRate));
  for (let index = 0; index < output.length; index += 1) {
    const source = (index * inputRate) / outputRate;
    const lower = Math.floor(source);
    const upper = Math.min(lower + 1, input.length - 1);
    const mix = source - lower;
    output[index] = Math.max(-1, Math.min(1, input[lower] * (1 - mix) + input[upper] * mix)) * 0x7fff;
  }
  return output;
}

function int16ToBase64(samples: Int16Array) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return window.btoa(binary);
}

function base64ToInt16(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer);
}
