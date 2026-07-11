import assert from "node:assert/strict";
import test from "node:test";
import { curatedMemoryCustomId, parseMemoryUpdates } from "./live-memory.mjs";

test("accepts a bounded, well-formed memory update", () => {
  const updates = parseMemoryUpdates(JSON.stringify({
    updates: [{ scope: "profile", key: "walking-limit", fact: "Cannot walk more than 1 km at a time.", tags: ["mobility"] }],
  }));
  assert.deepEqual(updates, [{ scope: "profile", key: "walking-limit", fact: "Cannot walk more than 1 km at a time.", tags: ["mobility"] }]);
});

test("drops malformed and duplicate curator updates", () => {
  const updates = parseMemoryUpdates(JSON.stringify({
    updates: [
      { scope: "trip", key: "hotel", fact: "Staying near Indiranagar Metro.", tags: [] },
      { scope: "trip", key: "hotel", fact: "Duplicate should not survive.", tags: [] },
      { scope: "trip", key: "not a key", fact: "Invalid key.", tags: [] },
    ],
  }));
  assert.equal(updates.length, 1);
  assert.equal(curatedMemoryCustomId({ id: "trip-1", userId: "user-1" }, updates[0]), "lens-curated:trip:trip-1:hotel");
});
