"use client";

import { Brain, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { loadSavedTrips } from "@/lib/trip-registry";
import type { MemoryContext, TripProfile } from "@/lib/travel-types";
import { useMagellanStore } from "./store";

type SnapshotState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; memory: MemoryContext }
  | { kind: "error"; message: string };

export function MemorySheet() {
  const activeTripId = useMagellanStore((state) => state.activeTripId);
  const [isOpen, setIsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotState>({ kind: "idle" });
  const trip = loadSavedTrips().find((candidate) => candidate.id === activeTripId);

  const loadMemory = useCallback(async () => {
    if (!trip) {
      setSnapshot({ kind: "error", message: "Save this trip first to create a traveler memory." });
      return;
    }

    setSnapshot({ kind: "loading" });
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(trip.id)}/query-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: trip.userId,
          q: "Travel preferences, durable constraints, confirmed plans, locations, dates, and corrections for this trip.",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { memory?: MemoryContext; error?: string };
      if (!response.ok || !body.memory) throw new Error(body.error || "Could not load the traveler memory.");
      setSnapshot({ kind: "ready", memory: body.memory });
    } catch (error) {
      setSnapshot({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not load the traveler memory.",
      });
    }
  }, [trip]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <button
        className="absolute right-5 top-[calc(1.25rem+env(safe-area-inset-top,0px))] z-20 inline-flex h-10 items-center gap-2 rounded-full border border-[#8d7760]/20 bg-[#fffdfa]/80 px-3 text-xs font-semibold text-[#50483f] shadow-[0_8px_24px_rgba(84,68,49,0.12)] backdrop-blur-md transition hover:bg-[#fffdfa]"
        type="button"
        onClick={() => {
          setIsOpen(true);
          void loadMemory();
        }}
        aria-haspopup="dialog"
      >
        <Brain size={16} strokeWidth={1.8} />
        Memory
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Traveler memory">
          <button className="absolute inset-0 bg-[#292018]/30 backdrop-blur-sm" type="button" onClick={() => setIsOpen(false)} aria-label="Close traveler memory" />
          <section className="relative flex max-h-[min(42rem,88dvh)] w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-[#fbf7f1]/95 shadow-[0_24px_80px_rgba(57,42,28,0.28)] backdrop-blur-xl">
            <header className="flex items-start justify-between border-b border-[#8d7760]/15 px-5 pb-4 pt-5">
              <div>
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#8a745e]">Lens memory</p>
                <h2 className="mt-1 font-[family-name:var(--font-magellan-display)] text-2xl font-semibold tracking-tight text-[#302820]">
                  {trip?.destinationCity || "Traveler context"}
                </h2>
                <p className="mt-1 text-xs leading-5 text-[#71685d]">Explicit preferences, plans, and corrections Lens can use.</p>
              </div>
              <button className="grid h-9 w-9 place-items-center rounded-full text-[#71685d] hover:bg-[#eee4d7]" type="button" onClick={() => setIsOpen(false)} aria-label="Close">
                <X size={19} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {snapshot.kind === "loading" || snapshot.kind === "idle" ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center text-sm text-[#71685d]">
                  <RefreshCw className="animate-spin" size={20} />
                  Loading the context saved for this trip…
                </div>
              ) : snapshot.kind === "error" ? (
                <div className="rounded-2xl border border-[#b99078]/25 bg-[#f6ece4] p-4 text-sm leading-6 text-[#735642]">
                  {snapshot.message}
                </div>
              ) : (
                <MemoryGroups memory={snapshot.memory} trip={trip} />
              )}
            </div>

            <footer className="flex items-center justify-between border-t border-[#8d7760]/15 px-5 py-3">
              <p className="max-w-56 text-[0.68rem] leading-4 text-[#837669]">Only durable travel context is shown here, never raw Live transcripts.</p>
              <button className="inline-flex items-center gap-1.5 rounded-full bg-[#e9dfd2] px-3 py-2 text-xs font-semibold text-[#50483f] hover:bg-[#dfd0bf]" type="button" onClick={() => void loadMemory()}>
                <RefreshCw size={14} /> Refresh
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function MemoryGroups({ memory, trip }: { memory: MemoryContext; trip?: TripProfile }) {
  const groups = [
    { label: "Profile", facts: uniqueFacts(memory.profileStatic) },
    { label: "Current context", facts: uniqueFacts(memory.profileDynamic) },
    { label: "Saved trip facts", facts: uniqueFacts(memory.memories) },
  ].filter((group) => group.facts.length);

  if (!memory.available) {
    return <p className="rounded-2xl border border-[#b99078]/25 bg-[#f6ece4] p-4 text-sm leading-6 text-[#735642]">{memory.message}</p>;
  }

  if (!groups.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[#8d7760]/25 p-5 text-sm leading-6 text-[#71685d]">
        No curated facts are saved yet. As you confirm durable preferences, plans, or corrections in Live, Lens will add them here.
        {trip?.destinationCity ? ` Your current trip is ${trip.destinationCity}.` : ""}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="mb-2 text-[0.68rem] font-bold uppercase tracking-[0.15em] text-[#8a745e]">{group.label}</h3>
          <ul className="space-y-2">
            {group.facts.map((fact) => (
              <li key={fact} className="rounded-xl border border-[#8d7760]/12 bg-white/55 px-3.5 py-3 text-sm leading-5 text-[#443a30] shadow-sm">{fact}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function uniqueFacts(facts: string[]) {
  return [...new Set(facts.map((fact) => fact.trim()).filter(Boolean))].slice(0, 16);
}
