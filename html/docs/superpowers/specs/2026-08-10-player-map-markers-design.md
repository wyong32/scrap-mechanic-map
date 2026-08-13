# Player Map Markers Design

## Goal

Let players add, find, edit, and delete private notes at exact map coordinates. Markers must work on the built-in default map and on imported personal worlds without changing game saves, official map data, or server state.

## Scope

The first release supports:

- an explicit `Add Marker` mode;
- marker name, type, notes, region, and coordinates;
- the preset types `Resource`, `Danger`, `Base`, `Vehicle`, and `Note`;
- viewing, editing, and deleting markers;
- browser-local persistence;
- isolation between the default map and imported worlds;
- search and existing map-layer integration.

Cloud synchronization, file import/export, attachments, marker sharing, and custom icons or colors are outside this release.

## Interaction Design

Add an `Add Marker` button to the map controls. Activating it changes the button to `Cancel Adding`, applies a placement cursor to the map, and waits for one map click. Panning and zooming remain available until the final placement click.

After a placement click, the details panel presents a form with:

- `Name`, required after trimming whitespace;
- `Type`, one of the five presets;
- `Notes`, optional multiline text;
- read-only `X` and `Y` coordinates;
- `Save Marker` and `Cancel` actions.

Saving immediately adds the marker to the map and location list, selects it, and exits placement mode. Cancelling discards the draft. A selected player marker uses the details panel to show its name, type, notes, and coordinates, with `Edit` and `Delete` actions. Delete requires explicit confirmation.

The map-layer controls include a `Player Markers` checkbox that is enabled by default. It controls marker icons without changing stored data. Marker names additionally follow the existing `Location Names` layer. Player markers participate in the existing name search. Their five preset types use distinct fixed icons and colors, while remaining visually different from official POIs.

## Map and Save Isolation

Markers are partitioned by a stable map scope and region.

- The built-in reference world uses a fixed default-map scope.
- An imported world uses `save:<seed>:<layout-hash>`, where `layout-hash` is a SHA-256 digest of the normalized ordered terrain-cell coordinates, UUIDs, offsets, and rotations. The filename and mutable save progress are excluded.
- Each fixed region has its own region ID within that map scope.

Reimporting the same world restores its markers. Importing a different world cannot expose or overwrite another world's markers. Returning to the default map restores the default-map markers.

## Data Model

Use a dedicated player-marker model rather than adding records to the official location catalog:

```ts
interface PlayerMarker {
  id: string;
  mapScopeId: string;
  regionId: string;
  position: { x: number; y: number };
  name: string;
  type: "resource" | "danger" | "base" | "vehicle" | "note";
  notes: string;
  createdAt: string;
  updatedAt: string;
}
```

IDs are generated locally and must not depend on coordinates, allowing multiple distinct markers at one position. Stored records are versioned so future migrations can be added without changing official map schemas.

## Components and Responsibilities

### Player marker store

A small repository owns serialization, validation, scope filtering, and local persistence. Its public operations are list, create, update, and delete. It reads and writes one versioned `localStorage` document and returns immutable records to the controller.

### Player marker map layer

A dedicated Leaflet layer renders marker icons, selected state, and optional names. It converts game-cell coordinates through the existing coordinate system and reports marker selection through callbacks. It does not own persistence or forms.

### Marker editor

A focused details-panel component renders create and edit forms, validates the name, and reports save, cancel, edit, and delete intents. It does not write storage directly.

### Application controller

The controller owns placement mode, creates map-scope identities, coordinates the store, refreshes the current marker set after mutations, and keeps list, map selection, and details state synchronized.

### Existing location browser

The browser receives an additional player-marker result source. Search matches marker names and notes. Official category filters continue to control official locations; player-marker types are presented as a separate compact filter group so their meanings are not confused with official categories.

## Data Flow

1. Application startup determines the active map scope and region.
2. The controller loads markers for that scope and region from the store.
3. The map layer and location browser render the same filtered marker collection.
4. `Add Marker` enables placement mode.
5. A map click is converted to game-cell coordinates and becomes an unsaved draft.
6. The editor validates and submits the draft.
7. The store persists it, then the controller refreshes the visible collection and selection.
8. Edit and delete follow the same controller-to-store flow.
9. Region, save, or base-map changes replace the visible marker collection with the matching partition.

## Validation and Failure Handling

- Empty or whitespace-only names are rejected inline.
- Unknown types, invalid coordinates, malformed timestamps, and records with missing scope or region IDs are ignored during loading.
- A malformed storage document is quarantined in memory for the session and reported through the existing status area; the map continues loading with an empty marker collection.
- A storage quota or write failure leaves the editor and entered values open and reports that the marker was not saved.
- Cancelling placement, switching regions, exiting personal-map mode, or destroying the app clears any unsaved draft.
- Delete confirmation identifies the marker by name and does not remove anything until confirmed.

## Accessibility and Responsive Behavior

All controls and marker buttons have English accessible names. Placement mode is announced through the status area. Keyboard users can cancel placement with `Escape`; form focus moves to `Name` after choosing a coordinate and returns to the selected marker or `Add Marker` button after completion. The editor uses the existing mobile details-panel behavior and requires no precision right-click action.

## Testing Strategy

Unit and integration tests cover:

- store validation, persistence, update, delete, and corrupted data;
- separation of default and imported-world scopes and regions;
- placement-mode entry, cancellation, coordinate conversion, and cleanup;
- required-name validation and write failures that preserve form values;
- create, select, edit, confirm-delete, and list refresh flows;
- marker icon visibility and names following `Location Names`;
- name and notes search plus type filtering;
- restoration after application reload and reimport of the same world;
- keyboard and accessible-name behavior;
- existing official locations, labels, and save import behavior remaining unchanged.

Implementation follows test-driven development: each behavior receives a failing test before production code is added, followed by focused regression tests and a production build.
