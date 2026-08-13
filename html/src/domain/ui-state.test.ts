import { describe, expect, it } from "vitest";
import {
  normalizeMapLayerIds,
  resolveVisibleMapLayerIds
} from "./map-layers";
import { parseUiState, serializeUiState } from "./ui-state";

describe("map UI URL state", () => {
  it("round-trips non-sensitive map state", () => {
    const state = parseUiState(
      "?region=surface&z=-2&x=12&y=-8&q=lab&cat=boss,quest&selected=grow-lab-1",
    );

    expect(state).toMatchObject({
      regionId: "surface",
      zoom: -2,
      center: { x: 12, y: -8 },
      query: "lab",
    });
    expect(serializeUiState(state)).toContain("selected=grow-lab-1");
  });

  it("canonicalizes removed overview zoom levels to the new minimum", () => {
    const state = parseUiState("?region=surface&z=-4&x=0&y=0");

    expect(state.zoom).toBe(-3);
    expect(serializeUiState(state)).toContain("z=-3");
  });

  it("drops save-like keys", () => {
    const state = parseUiState("?region=surface&save=C%3A%5Cprivate.db&seed=123");
    const encoded = serializeUiState(state);

    expect(encoded).not.toContain("save");
    expect(encoded).not.toContain("seed");
  });

  it("clamps URL zoom to the supported map range", () => {
    expect(parseUiState("?z=-5").zoom).toBe(-3);
    expect(parseUiState("?z=-4").zoom).toBe(-3);
    expect(parseUiState("?z=1").zoom).toBe(0);
    expect(parseUiState("?z=not-a-number").zoom).toBe(0);
    expect(parseUiState("?z=-2&x=Infinity&y=not-a-number")).toMatchObject({
      zoom: -2,
      center: { x: 0, y: 0 }
    });
  });

  it("drops identifiers longer than 100 characters", () => {
    const longId = "a".repeat(101);
    const state = parseUiState(`?region=${longId}&cat=poi,${longId}&selected=${longId}`);

    expect(state.regionId).toBe("surface");
    expect(state.categoryIds).toEqual(["poi"]);
    expect(state.selectedLocationId).toBeUndefined();
  });

  it("defaults location names off and round-trips public type IDs in stable order", () => {
    expect(parseUiState("?").locationTypeIds).toEqual([]);
    const state = parseUiState(
      "?locationTypes=generated%3Awarehouse,fixed%3Amechanic-station,generated%3Awarehouse",
    );

    expect(state.locationTypeIds).toEqual([
      "fixed:mechanic-station",
      "generated:warehouse"
    ]);
    expect(serializeUiState(state)).toContain(
      "locationTypes=fixed%3Amechanic-station%2Cgenerated%3Awarehouse"
    );
  });

  it("drops unsafe, unknown-shape, and private-looking location type IDs", () => {
    expect(
      parseUiState(
        "?locationTypes=POI_WAREHOUSE2_LARGE,C%3A%5Csave.db,generated%3Awarehouse"
      ).locationTypeIds
    ).toEqual(["generated:warehouse"]);
  });

  it("keeps category filters separate from allowlisted map layers", () => {
    const state = parseUiState(
      "?cat=boss,quest&layers=terrain,poi,not-a-map-layer",
    );

    expect(state.categoryIds).toEqual(["boss", "quest"]);
    expect(state.layerIds).toEqual(["terrain", "poi"]);
    expect(serializeUiState(state)).toContain("layers=terrain%2Cpoi");
  });

  it("supports an optional labels layer without enabling it by default", () => {
    expect(resolveVisibleMapLayerIds([]).has("labels")).toBe(false);
    expect(normalizeMapLayerIds(["terrain", "labels"])).toEqual([
      "terrain",
      "labels"
    ]);
    expect(parseUiState("?layers=terrain%2Clabels").layerIds).toEqual([
      "terrain",
      "labels"
    ]);
  });

  it("shows authentic terrain and player markers by default", () => {
    expect([...resolveVisibleMapLayerIds([])]).toEqual([
      "terrain",
      "player-markers"
    ]);
  });

  it("round-trips selected player marker types in stable order", () => {
    const state = parseUiState("?markers=resource%2Cbase");

    expect(state.playerMarkerTypeIds).toEqual(["base", "resource"]);
    expect(serializeUiState(state)).toContain("markers=base%2Cresource");
  });

  it("selects all player marker types when the URL parameter is absent", () => {
    expect(parseUiState("").playerMarkerTypeIds).toEqual([
      "base",
      "danger",
      "note",
      "resource",
      "vehicle"
    ]);
  });

  it("drops unknown and duplicate player marker types", () => {
    const state = parseUiState(
      "?markers=vehicle%2Cunknown%2Cresource%2Cvehicle"
    );

    expect(state.playerMarkerTypeIds).toEqual(["resource", "vehicle"]);
    expect(serializeUiState(state)).toContain("markers=resource%2Cvehicle");
  });

  it("preserves an explicit empty player marker type selection", () => {
    const state = parseUiState("?markers=");

    expect(state.playerMarkerTypeIds).toEqual([]);
    expect(serializeUiState(state)).toContain("markers=");
  });
});
