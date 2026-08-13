import { afterEach, expect, it } from "vitest";
import type { MapUiState } from "../domain/map-model";
import type {
  PlayerMarker,
  PlayerMarkerDraft
} from "../player-markers/player-marker";
import { createAppShell } from "./app-shell";

const draft: PlayerMarkerDraft = {
  mapScopeId: "default",
  regionId: "surface",
  position: { x: 12, y: -4 },
  name: "",
  type: "resource",
  notes: ""
};

const marker: PlayerMarker = {
  ...draft,
  id: "marker-1",
  name: "Cotton field",
  notes: "Bring crates",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z"
};

const state: MapUiState = {
  regionId: "surface",
  center: { x: 0, y: 0 },
  zoom: 0,
  query: "",
  categoryIds: [],
  locationTypeIds: [],
  playerMarkerTypeIds: ["base", "danger", "note", "resource", "vehicle"],
  layerIds: ["terrain", "labels", "player-markers"]
};

afterEach(() => {
  document.body.replaceChildren();
});

it("keeps the visible player marker workflow inventory in English", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const shell = createAppShell(root, {});
  const visibleStates: string[] = [];
  const capture = () => visibleStates.push(
    root.textContent?.replace(/\s+/g, " ").trim() ?? ""
  );

  capture();
  shell.setMarkerPlacementMode(true);
  shell.setStatus("Select a map position for the new marker.");
  capture();
  shell.renderPlayerMarker();
  capture();
  shell.renderPlayerMarkerDraft(draft);
  capture();
  clickButton(root, "Save Marker");
  capture();
  shell.setMarkerEditorError("Player marker could not be saved.");
  capture();
  shell.renderLocations({ locations: [], playerMarkers: [marker], state });
  capture();
  shell.renderPlayerMarker(marker, { focus: false });
  capture();
  clickButton(root, "Delete");
  capture();
  shell.renderPlayerMarkerEdit(marker);
  capture();
  shell.setStatus("Saved player markers could not be read.");
  capture();

  const inventory = [
    "Player Markers",
    "Add Marker",
    "Cancel Adding",
    "Player Marker Types",
    "Resource",
    "Danger",
    "Base",
    "Vehicle",
    "Note",
    "Select a map position for the new marker.",
    "Select a player marker or choose Add Marker.",
    "New Player Marker",
    "Edit Player Marker",
    "Name",
    "Type",
    "Notes",
    "Save Marker",
    "Save Changes",
    "Cancel",
    "Name is required.",
    "Player marker could not be saved.",
    "Saved player markers could not be read.",
    "Player Marker",
    "Coordinates",
    "Edit",
    "Delete",
    "Delete Cotton field?",
    "This marker will be removed from this browser.",
    "Delete Marker",
    "Keep Marker"
  ];

  for (const copy of inventory) {
    expect(
      visibleStates.some((stateText) => stateText.includes(copy)),
      copy
    ).toBe(true);
  }
  expect(
    visibleStates.filter((stateText) => /[\u3400-\u9fff]/u.test(stateText))
  ).toEqual([]);

  shell.destroy();
});

function clickButton(root: HTMLElement, name: string): void {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === name);
  expect(button, name).toBeDefined();
  button!.click();
}
