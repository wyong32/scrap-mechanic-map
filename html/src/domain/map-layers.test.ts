import { expect, it } from "vitest";
import {
  DEFAULT_MAP_LAYER_IDS,
  getMapLayerDefinition,
  normalizeMapLayerIds,
  resolveVisibleMapLayerIds
} from "./map-layers";

it("makes player markers an available and default-visible map layer", () => {
  expect(getMapLayerDefinition("player-markers")).toEqual({
    id: "player-markers",
    available: true,
    defaultVisible: true,
    categoryIds: []
  });
  expect(DEFAULT_MAP_LAYER_IDS).toContain("player-markers");
  expect(resolveVisibleMapLayerIds([]).has("player-markers")).toBe(true);
});

it("preserves the player marker layer through normalized saved visibility", () => {
  expect(normalizeMapLayerIds([
    "player-markers",
    "unknown",
    "player-markers"
  ])).toEqual(["player-markers"]);
  expect(
    resolveVisibleMapLayerIds(["player-markers"]).has("player-markers")
  ).toBe(true);
});
