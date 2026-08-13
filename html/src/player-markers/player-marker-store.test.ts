import { describe, expect, it } from "vitest";
import type { PlayerMarkerDraft } from "./player-marker";
import {
  PLAYER_MARKER_STORAGE_KEY,
  type PlayerMarkerDocument,
  PlayerMarkerStore
} from "./player-marker-store";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  constructor(initialValue?: string) {
    if (initialValue !== undefined) {
      this.values.set(PLAYER_MARKER_STORAGE_KEY, initialValue);
    }
  }

  get length(): number {
    return this.values.size;
  }

  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class ThrowingWriteStorage extends MemoryStorage {
  get currentValue(): string | null {
    return this.getItem(PLAYER_MARKER_STORAGE_KEY);
  }

  override setItem(): void {
    throw new Error("quota exceeded");
  }
}

class ThrowingReadStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error("storage denied");
  }
}

const validDraft: PlayerMarkerDraft = {
  mapScopeId: "default",
  regionId: "surface",
  position: { x: 12.5, y: -4 },
  name: "Cotton field",
  type: "resource",
  notes: "Return with storage crates"
};

const validDocument = JSON.stringify({
  version: 1,
  markers: [{
    id: "existing-marker",
    ...validDraft,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z"
  }]
} satisfies PlayerMarkerDocument);

describe("PlayerMarkerStore", () => {
  it("persists and restores only markers from the requested map scope and region", () => {
    const storage = new MemoryStorage();
    const store = new PlayerMarkerStore(storage, {
      now: () => "2026-08-10T00:00:00.000Z",
      createId: () => "marker-1"
    });

    store.create(validDraft);

    expect(new PlayerMarkerStore(storage).list("default", "surface"))
      .toMatchObject([{ id: "marker-1", name: "Cotton field" }]);
    expect(new PlayerMarkerStore(storage).list("save:2:abc", "surface")).toEqual([]);
    expect(new PlayerMarkerStore(storage).list("default", "grow-lab")).toEqual([]);
  });

  it("does not replace persisted data when a write fails", () => {
    const storage = new ThrowingWriteStorage(validDocument);
    const store = new PlayerMarkerStore(storage);

    expect(() => store.create(validDraft)).toThrow("Player marker could not be saved.");
    expect(storage.currentValue).toBe(validDocument);
  });

  it("ignores invalid records and reports a malformed document", () => {
    const malformedStore = new PlayerMarkerStore(new MemoryStorage("{"));
    expect(malformedStore.load()).toEqual({
      markers: [],
      warning: "Saved player markers could not be read."
    });

    const invalidRecordStore = new PlayerMarkerStore(new MemoryStorage(JSON.stringify({
      version: 1,
      markers: [{ id: "bad", name: "Missing fields" }]
    })));
    expect(invalidRecordStore.load()).toEqual({
      markers: [],
      warning: "Saved player markers could not be read."
    });
  });

  it("ignores invalid timestamps and empty record identities", () => {
    const validMarker = JSON.parse(validDocument).markers[0];
    const store = new PlayerMarkerStore(new MemoryStorage(JSON.stringify({
      version: 1,
      markers: [
        validMarker,
        { ...validMarker, id: "", createdAt: "not-a-date" },
        { ...validMarker, id: "bad-created", createdAt: "not-a-date" },
        { ...validMarker, id: "bad-updated", updatedAt: "" },
        { ...validMarker, id: "empty-scope", mapScopeId: "" },
        { ...validMarker, id: "empty-region", regionId: "" }
      ]
    })));

    expect(store.load()).toEqual({
      markers: [expect.objectContaining({ id: "existing-marker" })],
      warning: "Saved player markers could not be read."
    });
  });

  it("degrades to an empty warning result when storage reads fail", () => {
    expect(new PlayerMarkerStore(new ThrowingReadStorage()).load()).toEqual({
      markers: [],
      warning: "Saved player markers could not be read."
    });
  });

  it("normalizes marker names and rejects invalid drafts", () => {
    const store = new PlayerMarkerStore(new MemoryStorage(), {
      now: () => "2026-08-10T00:00:00.000Z",
      createId: () => "marker-1"
    });

    expect(store.create({ ...validDraft, name: "  Cotton field  " }).name).toBe("Cotton field");
    expect(() => store.create({ ...validDraft, name: "  " })).toThrow("Player marker name is required.");
    expect(() => store.create({ ...validDraft, position: { x: Number.NaN, y: 4 } }))
      .toThrow("Player marker position must use finite coordinates.");
    expect(() => store.create({ ...validDraft, type: "unknown" as PlayerMarkerDraft["type"] }))
      .toThrow("Player marker type is invalid.");
    expect(() => store.create({ ...validDraft, mapScopeId: "" }))
      .toThrow("Player marker is invalid.");
    expect(() => store.create({ ...validDraft, regionId: "   " }))
      .toThrow("Player marker is invalid.");
  });

  it("updates and returns cloned marker data without mutating callers", () => {
    const storage = new MemoryStorage();
    const store = new PlayerMarkerStore(storage, {
      now: () => "2026-08-10T00:00:00.000Z",
      createId: () => "marker-1"
    });
    const draft = { ...validDraft, position: { ...validDraft.position } };
    const created = store.create(draft);
    draft.position.x = 99;
    created.position.y = 99;

    const updated = store.update("marker-1", {
      name: "  Cotton reserve ",
      type: "base",
      notes: "Bring crates"
    });
    updated.position.x = 99;

    expect(store.list("default", "surface")).toMatchObject([{
      id: "marker-1",
      name: "Cotton reserve",
      type: "base",
      position: { x: 12.5, y: -4 }
    }]);
  });

  it("returns fresh nested positions from each direct load", () => {
    const store = new PlayerMarkerStore(new MemoryStorage(validDocument));
    const first = store.load();
    first.markers[0]!.position.x = 999;

    expect(store.load().markers[0]?.position.x).toBe(12.5);
  });

  it("deletes only the requested marker", () => {
    const storage = new MemoryStorage(validDocument);
    const store = new PlayerMarkerStore(storage);

    store.delete("existing-marker");

    expect(store.list("default", "surface")).toEqual([]);
  });
});
