"use client";

import { Check, ChevronLeft } from "lucide-react";
import { useMagellanStore } from "./store";

export function TreasureHuntPage() {
  const game = useMagellanStore((state) => state.cityGame);
  const activeTargetId = useMagellanStore((state) => state.activeGameTargetId);
  const setActiveTarget = useMagellanStore((state) => state.setActiveGameTarget);
  const setGamePageOpen = useMagellanStore((state) => state.setGamePageOpen);

  if (!game) return null;
  const remaining = game.targets.filter((target) => !target.completed).length;

  return (
    <section className="treasure-page" aria-label="City finds">
      <header className="treasure-page__header">
        <button type="button" className="treasure-page__back" onClick={() => setGamePageOpen(false)} aria-label="Back to chat">
          <ChevronLeft size={21} />
        </button>
        <div>
          <p>City finds</p>
          <h2>{game.city}</h2>
        </div>
        <span className="treasure-page__score">{game.score} pts</span>
      </header>

      <div className="treasure-page__intro">
        <span>{remaining ? `${remaining} finds left. Pick one, then return to the live view when you are ready to capture it.` : "Hunt complete."}</span>
      </div>

      <ol className="treasure-page__targets">
        {game.targets.map((target, index) => {
          const isActive = target.id === activeTargetId;
          return (
            <li key={target.id} className={`treasure-target ${target.completed ? "is-complete" : ""} ${isActive ? "is-active" : ""}`}>
              <button
                type="button"
                className="treasure-target__select"
                disabled={target.completed}
                onClick={() => setActiveTarget(target.id)}
              >
                <span className="treasure-target__index">{target.completed ? <Check size={15} /> : index + 1}</span>
                <span className="treasure-target__copy">
                  <strong>{target.title}</strong>
                  <small>{target.hint}</small>
                </span>
                <span className="treasure-target__points">{target.points} pts</span>
              </button>
            </li>
          );
        })}
      </ol>

      {!remaining && <p className="treasure-page__complete">All city finds captured.</p>}
    </section>
  );
}
