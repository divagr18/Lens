import type { TripProfile } from "@/lib/travel-types";

const tripsKey = "lens-saved-trips-v1";
const activeTripKey = "lens-active-trip-id";

export const defaultTripProfile: TripProfile = {
  id: "default-bengaluru-indiranagar",
  userId: "demo-user",
  destinationCity: "Indiranagar, Bengaluru",
  dates: "July 11 to July 13",
  hotel: "Indiranagar, Bengaluru",
  budget: "Rs 2,500 per day for daily travel, food, and activities.",
  dietaryRules: "Vegetarian.",
  mobilityAndLuggage: "No additional mobility or luggage constraints saved yet.",
  languagePreferences: "English primary; Hindi and Kannada helpful when useful.",
  itinerary: "Land on the 11th, leave on the 13th, and explore cool Indiranagar cafes.",
};

export function loadSavedTrips(): TripProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(tripsKey) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(isTripProfile) : [];
  } catch {
    return [];
  }
}

export function saveTripToRegistry(trip: TripProfile) {
  if (typeof window === "undefined") return;
  const trips = loadSavedTrips();
  const nextTrips = [trip, ...trips.filter((candidate) => candidate.id !== trip.id)].slice(0, 12);
  window.localStorage.setItem(tripsKey, JSON.stringify(nextTrips));
  window.localStorage.setItem(activeTripKey, trip.id);
}

export function ensureDefaultTripRegistry(): TripProfile[] {
  if (typeof window === "undefined") return [defaultTripProfile];
  const savedTrips = loadSavedTrips();
  if (savedTrips.length) return savedTrips;
  window.localStorage.setItem(tripsKey, JSON.stringify([defaultTripProfile]));
  window.localStorage.setItem(activeTripKey, defaultTripProfile.id);
  return [defaultTripProfile];
}

export function loadActiveTripId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(activeTripKey) ?? "";
}

export function setActiveTripId(tripId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(activeTripKey, tripId);
}

function isTripProfile(value: unknown): value is TripProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TripProfile>;
  return typeof candidate.id === "string" && typeof candidate.userId === "string";
}
