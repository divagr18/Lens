import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Trip } from "./config";
import { useMagellanStore } from "./store";

export function TripSelector() {
  const trips = useMagellanStore((state) => state.trips);
  const activeTripId = useMagellanStore((state) => state.activeTripId);
  const setActiveTrip = useMagellanStore((state) => state.setActiveTrip);
  const addTrip = useMagellanStore((state) => state.addTrip);
  const deleteTrip = useMagellanStore((state) => state.deleteTrip);
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [destination, setDestination] = useState("");
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? trips[0];

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function submitTrip(event: FormEvent) {
    event.preventDefault();
    if (!destination.trim()) return;
    addTrip(destination);
    setDestination("");
    setIsAdding(false);
    setIsOpen(false);
  }

  return (
    <div className="trip-selector" ref={rootRef}>
      <button className="trip-selector__trigger" type="button" onClick={() => setIsOpen((open) => !open)} aria-haspopup="menu" aria-expanded={isOpen}>
        <span>{activeTrip.destination}</span><ChevronDown aria-hidden="true" size={22} strokeWidth={1.8} />
      </button>
      {isOpen && (
        <div className="trip-selector__menu" role="menu" aria-label="Choose a trip">
          {trips.map((trip) => (
            <div key={trip.id} className="trip-selector__row">
              <button
                className="trip-selector__option"
                type="button"
                role="menuitem"
                onClick={() => {
                  setActiveTrip(trip.id);
                  setIsOpen(false);
                }}
              >
                <span>{trip.destination}</span>
                {trip.id === activeTripId && <Check aria-label="Current trip" size={17} />}
              </button>
              {trips.length > 1 && (
                <button
                  className="trip-selector__delete"
                  type="button"
                  title={`Delete trip to ${trip.destination}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setTripToDelete(trip);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
          <div className="trip-selector__divider" />
          <button className="trip-selector__add" type="button" role="menuitem" onClick={() => setIsAdding(true)}>
            <Plus size={17} /> Add trip
          </button>
          {isAdding && (
            <form className="trip-selector__form" onSubmit={submitTrip}>
              <label htmlFor="new-trip-destination">Destination</label>
              <input id="new-trip-destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="e.g. Paris" autoFocus />
              <button type="submit">Add</button>
            </form>
          )}
        </div>
      )}
      {tripToDelete && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-[#282119]/40 backdrop-blur-sm" onClick={() => setTripToDelete(null)} aria-label="Cancel delete" />
          <div className="relative flex w-full max-w-xs flex-col gap-4 rounded-2xl border border-[#96846f]/20 bg-[#fbf7f1] p-6 text-center shadow-2xl">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-600"><Trash2 size={22} /></div>
            <div>
              <h3 className="font-semibold">Delete trip?</h3>
              <p className="mt-1 text-xs text-[#71685d]">Delete the trip <strong>{tripToDelete.destination}</strong>?</p>
            </div>
            <button
              className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-medium text-white"
              onClick={() => {
                deleteTrip(tripToDelete.id);
                setTripToDelete(null);
                setIsOpen(false);
              }}
            >
              Yes, delete
            </button>
            <button className="rounded-xl bg-[#e9dfd2] px-4 py-2 text-xs font-medium text-[#50483f]" onClick={() => setTripToDelete(null)}>Go back</button>
          </div>
        </div>
      )}
    </div>
  );
}
