import { useMagellanStore, type ChatHistoryItem } from "./store";

export function useTripChatHistory() {
  const activeTripId = useMagellanStore((state) => state.activeTripId);
  const history = useMagellanStore((state) => state.chatHistoryByTrip[activeTripId] ?? []);
  const setHistory = useMagellanStore((state) => state.setChatHistory);
  return {
    activeTripId,
    history,
    setHistory: (items: ChatHistoryItem[]) => setHistory(activeTripId, items),
  };
}
