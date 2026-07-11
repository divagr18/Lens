import { useMagellanStore, type ChatHistoryItem } from "./store";

export function useTripChatHistory() {
  const activeTripId = useMagellanStore((state) => state.activeTripId);
  // Keep the Zustand selector referentially stable. Returning a fresh `[]` here
  // makes useSyncExternalStore believe its snapshot changed on every render.
  const storedHistory = useMagellanStore((state) => state.chatHistoryByTrip[activeTripId]);
  const setHistory = useMagellanStore((state) => state.setChatHistory);
  return {
    activeTripId,
    history: storedHistory ?? [],
    setHistory: (items: ChatHistoryItem[]) => setHistory(activeTripId, items),
  };
}
