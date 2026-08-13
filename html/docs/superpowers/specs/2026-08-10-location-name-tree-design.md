# Location Name Tree Design

## Goal

Move `Map Layers` from the map canvas into the left location panel and replace the single `Location Names` checkbox with a hierarchical, count-aware selector. The selector must let players independently show fixed/story labels and save-generated location labels without exposing internal POI identifiers.

## Scope

This change affects the left panel layout, location-label visibility state, URL serialization, and the conversion of world cells into user-facing location types. It does not change terrain rendering, player-marker storage, save-file privacy, map zoom, or fixed-region navigation.

The existing official-location catalog and save terrain decoder remain the sources of truth. No location count is hard-coded.

## Left Panel Layout

`Map Layers` moves below `Search Locations` and above `Player Marker Types`.

The visible top-level controls are:

- `Terrain`
- `Player Markers`
- `Coordinate Grid`
- `Location Names`

Unavailable future controls (`Roads` and `Progress`) are omitted from this panel until they have usable data.

`Location Names` is a disclosure row with a checkbox. Its arrow expands or collapses the tree without changing visibility. The checkbox controls all location-name descendants.

## Location Hierarchy

The hierarchy has three selection levels:

1. `Location Names`
2. Source group
3. User-facing location type

The source groups are:

- `Fixed & Story Locations`
- `Generated Locations`

Examples:

```text
Location Names
├─ Fixed & Story Locations (8)
│  ├─ Mechanic Station (1)
│  └─ Scrapyard (1)
└─ Generated Locations (36)
   ├─ Warehouse (2)
   ├─ Camps & Ruins (18)
   ├─ Road Locations (7)
   ├─ Resource & Hazard (5)
   └─ Builder Quest Locations (4)
```

Counts represent visible instances in the active world, not the number of internal POI constants. A multi-cell POI counts once after its cells are grouped into one placement.

Rows with a zero count are omitted. If a source group has no rows, the whole source group is omitted. If neither source group has data, `Location Names` stays visible but disabled and shows `No location data`.

## Classification Rules

### Fixed & Story Locations

Fixed/story locations come from `WorldMap.locations`. They use the stable catalog name and position already associated with the active region. They include stable reference labels such as Mechanic Station, Scrapyard, Mining Hub, and region/story entrances.

### Generated Locations

Generated locations come from `createPoiMapInstances(WorldMap.cells)`. Cells are grouped by POI type, tile UUID, placement key, adjacency, and rotation-aware offsets so a multi-cell structure is counted and labelled once.

Official Scrap Mechanic 1.0 `POI_*` constants are mapped into user-facing types. The UI never displays raw constants. The initial user-facing groups are:

- `Warehouse`
- `Camps & Ruins`
- `Road Locations`
- `Resource & Hazard`
- `Major Generated Locations`
- `Builder Quest Locations`

Predefined and story POI constants, including crash-site areas, mechanic stations, Grow Labs, scrapyards, excavation infrastructure, and other explicitly placed quest regions, are excluded from `Generated Locations`. When a matching stable catalog location exists, it appears under `Fixed & Story Locations` instead.

Unknown `POI_*` constants are fail-closed: they are not labelled and are reported only through development diagnostics. This prevents incorrect names from appearing on the player map.

The installed official 1.0 `poi_types.lua` is the authoritative classification input. Placeholder, test, retired, and no-longer-used constants are excluded.

## Selection Behaviour

Location names are all off by default.

- Checking `Location Names` selects every currently available descendant.
- Unchecking it clears every descendant.
- Checking a source group selects all available types in that group.
- Unchecking a source group clears all types in that group.
- Selecting only some descendants gives each affected ancestor an indeterminate state.
- Expanding or collapsing a row does not change selection.
- Newly imported save data does not silently enable labels that were previously unavailable.
- When the active world changes, selections that still exist are retained; unavailable type selections are removed.
- Player-marker name visibility remains independent from official/generated location-name visibility.

## State and URL

The existing `labels` layer becomes the master `Location Names` switch. A new allowlisted URL parameter stores selected location-type IDs in stable sorted order. The parameter contains only public type IDs, never save names, paths, seeds, UUIDs, or raw POI constants.

An absent location-type parameter means no location names are selected. An explicitly empty selection canonicalizes to the same state. Old URLs containing only `layers=labels` are migrated by enabling all location types available in the active world for that session, then serialized in the new canonical format.

## Components and Data Flow

### Location classification catalog

A focused catalog module converts official POI constants into:

- stable public type ID
- English display name
- source classification
- generated subgroup
- supported/retired status

### Location-name inventory

A pure inventory builder receives `WorldMap.locations` and grouped POI instances. It returns source groups, type counts, and label instances. The same inventory drives both the left-panel counts and the map label layer so the menu cannot disagree with the map.

### Left-panel tree

A dedicated tree component renders disclosure rows, checkboxes, counts, indeterminate states, keyboard operation, and change callbacks. It does not parse saves or inspect terrain cells.

### Map label layer

The map view receives the selected public type IDs and renders only matching inventory instances. Label rendering remains separate from player-marker rendering.

### Controller

The controller owns the active selection, rebuilds the inventory after a world commit, normalizes unavailable selections, updates the tree, updates the map label layer, and writes canonical non-sensitive URL state.

## Accessibility

- Disclosure buttons expose `aria-expanded` and have independent accessible names.
- Parent checkboxes expose native checked and indeterminate states.
- Counts are included in visible text but do not replace the location name.
- The tree is fully operable with Tab, Space, Enter, and arrow-key focus movement where applicable.
- Focus is restored to a surviving row after a world or save update.

## Error and Empty States

- Unknown POI types do not receive guessed labels.
- Invalid URL type IDs are dropped.
- Failed save imports retain the committed world's tree and selections.
- A pending world transition keeps the committed tree visible but disables changes until the new world commits or the transition fails.
- A world with no usable location metadata shows a disabled `Location Names — No location data` row.

## Testing

Tests cover:

- authoritative POI classification, including excluded predefined and retired types
- rotation-aware multi-cell grouping and one-instance counts
- fixed/generated inventory counts and zero-count omission
- parent, child, and indeterminate checkbox behaviour
- default-off state and legacy URL migration
- invalid URL ID removal and privacy-safe serialization
- world/save transitions, retained selections, and failed-transition rollback
- map labels matching tree selections exactly
- player-marker visibility remaining independent
- keyboard and focus behaviour
- production build and browser-level verification of the relocated controls

## Acceptance Criteria

- No map-layer panel overlays the map canvas.
- The left panel contains all currently usable map-layer controls.
- `Location Names` is off by default.
- Fixed/story and generated locations have independent multiselect trees.
- Every displayed count equals the number of corresponding active-world label instances.
- Warehouse and other save-generated counts change when a different save layout is committed.
- No raw `POI_*` value or private save metadata appears in the UI or URL.
- Existing terrain, player markers, search, save import, region switching, and zoom behaviour continue to work.
