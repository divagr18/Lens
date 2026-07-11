import { X } from "lucide-react";
import { useMagellanStore } from "./store";
import { useTripChatHistory } from "./useTripChatHistory";

export function ChatHistoryDrawer() {
  const isOpen = useMagellanStore((state) => state.isChatHistoryOpen);
  const setOpen = useMagellanStore((state) => state.setChatHistoryOpen);
  const { history } = useTripChatHistory();
  if (!isOpen) return null;
  return (
    <div className="chat-history-drawer" role="dialog" aria-modal="true" aria-label="Chat history">
      <button className="chat-history-drawer__backdrop" type="button" aria-label="Close chat history" onClick={() => setOpen(false)} />
      <aside className="chat-history-drawer__panel">
        <div className="chat-history-drawer__header">
          <h2>Chat history</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close chat history"><X size={21} /></button>
        </div>
        {history.length === 0 ? (
          <p className="chat-history-drawer__empty">No chats in this trip yet.</p>
        ) : (
          <ul>{history.map((chat) => <li key={chat.id}><button type="button">{chat.title}</button></li>)}</ul>
        )}
      </aside>
    </div>
  );
}
