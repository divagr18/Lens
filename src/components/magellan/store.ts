import { create } from "zustand";
import { INITIAL_TRIPS, type Trip } from "./config";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ChatHistoryItem {
  id: string;
  title: string;
  updatedAt: string;
}

export interface GameTarget {
  id: string;
  title: string;
  hint: string;
  successCriteria: string;
  points: number;
  completed: boolean;
}

export interface CityGame {
  gameId: string;
  city: string;
  createdAt: string;
  score: number;
  targets: GameTarget[];
}

export interface GameNotice {
  id: string;
  tone: "success" | "info" | "error";
  message: string;
}

interface AppState {
  orientation: "vertical" | "horizontal";
  isMuted: boolean;
  isVoiceActive: boolean;
  liveTranscription: string;
  messages: Message[];
  messagesByTrip: Record<string, Message[]>;
  trips: Trip[];
  activeTripId: string;
  isChatHistoryOpen: boolean;
  chatHistoryByTrip: Record<string, ChatHistoryItem[]>;
  gameTargets: GameTarget[];
  gameScore: number;
  cityGame?: CityGame;
  activeGameTargetId?: string;
  isGamePageOpen: boolean;
  gameNotice?: GameNotice;
  isCameraActive: boolean;
  facingMode: "user" | "environment";
  isGenerating: boolean;
  isConnected: boolean;
  isScrollingDown: boolean;
  inputText: string;
  isInputFocused: boolean;
  setOrientation: (orientation: "vertical" | "horizontal") => void;
  setMuted: (muted: boolean) => void;
  setVoiceActive: (active: boolean) => void;
  setLiveTranscription: (text: string) => void;
  addMessage: (message: Message, tripId?: string) => void;
  appendToLastMessage: (text: string, tripId?: string) => void;
  setActiveTrip: (tripId: string) => void;
  replaceTrips: (trips: Trip[], activeTripId?: string) => void;
  addTrip: (destination: string) => void;
  deleteTrip: (tripId: string) => void;
  setChatHistoryOpen: (open: boolean) => void;
  setChatHistory: (tripId: string, history: ChatHistoryItem[]) => void;
  setGame: (targets: GameTarget[], score: number) => void;
  setCityGame: (game?: CityGame) => void;
  setActiveGameTarget: (targetId?: string) => void;
  setGamePageOpen: (open: boolean) => void;
  setGameNotice: (notice?: GameNotice) => void;
  setCameraActive: (active: boolean) => void;
  setFacingMode: (mode: "user" | "environment") => void;
  toggleFacingMode: () => void;
  setIsGenerating: (generating: boolean) => void;
  setConnected: (connected: boolean) => void;
  setScrollingDown: (down: boolean) => void;
  setInputText: (text: string) => void;
  setInputFocused: (focused: boolean) => void;
}

export const useMagellanStore = create<AppState>((set) => ({
  orientation: "vertical",
  isMuted: false,
  isVoiceActive: false,
  liveTranscription: "",
  messages: [],
  messagesByTrip: { bengaluru: [] },
  trips: INITIAL_TRIPS,
  activeTripId: "bengaluru",
  isChatHistoryOpen: false,
  chatHistoryByTrip: {},
  gameTargets: [],
  gameScore: 0,
  cityGame: undefined,
  activeGameTargetId: undefined,
  isGamePageOpen: false,
  gameNotice: undefined,
  isCameraActive: false,
  facingMode: "environment",
  isGenerating: false,
  isConnected: false,
  isScrollingDown: false,
  inputText: "",
  isInputFocused: false,
  setOrientation: (orientation) => set({ orientation }),
  setMuted: (isMuted) => set({ isMuted }),
  setVoiceActive: (isVoiceActive) => set({ isVoiceActive }),
  setLiveTranscription: (liveTranscription) => set({ liveTranscription }),
  addMessage: (message, tripId) =>
    set((state) => {
      const id = tripId ?? state.activeTripId;
      const messages = [...(state.messagesByTrip[id] ?? []), message];
      return { messages, messagesByTrip: { ...state.messagesByTrip, [id]: messages } };
    }),
  appendToLastMessage: (text, tripId) =>
    set((state) => {
      const id = tripId ?? state.activeTripId;
      const messages = [...(state.messagesByTrip[id] ?? [])];
      const last = messages.at(-1);
      if (last?.role === "assistant") messages[messages.length - 1] = { ...last, content: last.content + text };
      else messages.push({ id: crypto.randomUUID(), role: "assistant", content: text });
      return { messages, messagesByTrip: { ...state.messagesByTrip, [id]: messages } };
    }),
  setActiveTrip: (tripId) =>
    set((state) =>
      state.trips.some((trip) => trip.id === tripId)
        ? { activeTripId: tripId, messages: state.messagesByTrip[tripId] ?? [] }
        : state
    ),
  replaceTrips: (trips, requestedActiveTripId) =>
    set((state) => {
      const nextTrips = trips.length ? trips : state.trips;
      const activeTripId = nextTrips.some((trip) => trip.id === requestedActiveTripId)
        ? requestedActiveTripId!
        : nextTrips.some((trip) => trip.id === state.activeTripId)
          ? state.activeTripId
          : nextTrips[0].id;
      return { trips: nextTrips, activeTripId, messages: state.messagesByTrip[activeTripId] ?? [] };
    }),
  addTrip: (destination) =>
    set((state) => {
      const cleanDestination = destination.trim();
      if (!cleanDestination) return state;
      const id = `${cleanDestination.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
      const trip = { id, destination: cleanDestination };
      return {
        trips: [...state.trips, trip],
        activeTripId: id,
        messages: [],
        messagesByTrip: { ...state.messagesByTrip, [id]: [] },
      };
    }),
  deleteTrip: (tripId) =>
    set((state) => {
      const trips = state.trips.filter((trip) => trip.id !== tripId);
      if (!trips.length) return state;
      const activeTripId = state.activeTripId === tripId ? trips[0].id : state.activeTripId;
      const messagesByTrip = { ...state.messagesByTrip };
      const chatHistoryByTrip = { ...state.chatHistoryByTrip };
      delete messagesByTrip[tripId];
      delete chatHistoryByTrip[tripId];
      return {
        trips,
        activeTripId,
        messages: messagesByTrip[activeTripId] ?? [],
        messagesByTrip,
        chatHistoryByTrip,
      };
    }),
  setChatHistoryOpen: (isChatHistoryOpen) => set({ isChatHistoryOpen }),
  setChatHistory: (tripId, history) =>
    set((state) => ({ chatHistoryByTrip: { ...state.chatHistoryByTrip, [tripId]: history } })),
  setGame: (gameTargets, gameScore) => set({ gameTargets, gameScore }),
  setCityGame: (cityGame) => set({
    cityGame,
    gameTargets: cityGame?.targets ?? [],
    gameScore: cityGame?.score ?? 0,
    activeGameTargetId: cityGame?.targets.find((target) => !target.completed)?.id,
  }),
  setActiveGameTarget: (activeGameTargetId) => set({ activeGameTargetId }),
  setGamePageOpen: (isGamePageOpen) => set({ isGamePageOpen }),
  setGameNotice: (gameNotice) => set({ gameNotice }),
  setCameraActive: (isCameraActive) => set({ isCameraActive }),
  setFacingMode: (facingMode) => set({ facingMode }),
  toggleFacingMode: () =>
    set((state) => ({ facingMode: state.facingMode === "user" ? "environment" : "user" })),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setConnected: (isConnected) => set({ isConnected }),
  setScrollingDown: (isScrollingDown) => set({ isScrollingDown }),
  setInputText: (inputText) => set({ inputText }),
  setInputFocused: (isInputFocused) => set({ isInputFocused }),
}));
