export interface Trip {
  id: string;
  destination: string;
}

/** Ported from Magellan@74e2da6; Lens trip persistence replaces this after hydration. */
export const INITIAL_TRIPS: Trip[] = [
  { id: "bengaluru", destination: "Bengaluru" },
  { id: "london", destination: "London" },
  { id: "tokyo", destination: "Tokyo" },
];
