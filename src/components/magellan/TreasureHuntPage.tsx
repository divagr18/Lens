"use client";

import { Check, ChevronLeft, Circle, Crosshair, MapPinned, Trophy } from "lucide-react";
import { useMagellanStore } from "./store";

export function TreasureHuntPage() {
  const game = useMagellanStore((state) => state.cityGame);
  const activeTargetId = useMagellanStore((state) => state.activeGameTargetId);
  const setActiveTarget = useMagellanStore((state) => state.setActiveGameTarget);
  const setGamePageOpen = useMagellanStore((state) => state.setGamePageOpen);
  const setOrientation = useMagellanStore((state) => state.setOrientation);

  if (!game) return null;
  const remaining = game.targets.filter((target) => !target.completed).length;

  return (
    <section className="treasure-page" aria-label="Treasure hunt">
      <header className="treasure-page__header">
        <button type="button" className="treasure-page__back" onClick={() => setGamePageOpen(false)} aria-label="Back to chat">
          <ChevronLeft size={21} />
        </button>
        <div>
          <p>City treasure hunt</p>
          <h2>{game.city}</h2>
        </div>
        <span className="treasure-page__score"><Trophy size={14} /> {game.score}</span>
      </header>

      <div className="treasure-page__intro">
        <MapPinned size={18} />
        <span>{remaining ? `${remaining} finds left. Pick one, then use the camera shutter to check it.` : "Hunt complete — beautiful work."}</span>
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
                <span className="treasure-target__points">{target.points}</span>
              </button>
              {!target.completed && isActive && (
                <button
                  type="button"
                  className="treasure-target__aim"
                  onClick={() => {
                    setOrientation("horizontal");
                    setGamePageOpen(false);
                  }}
                >
                  <Crosshair size={15} /> Aim camera
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {!remaining && <p className="treasure-page__complete"><Circle size={15} /> All city finds captured.</p>}
    </section>
  );
}
