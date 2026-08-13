# Authentic Legacy-First Terrain Design

## Goal

Render the bundled and uploaded 1.0 surface world from authentic, north-up game imagery wherever it is available, while preventing TileEditor thumbnails or unverified atlas crops from appearing as terrain.

## Decisions

- The checked-in `the1killer/sm_overview` orthographic JPG library is the primary terrain source.
- The generated 1.0 UUID-to-legacy-ID bridge selects those images for compatible 1.0 cells.
- Official atlas images are terrain only when their manifest explicitly marks them as `verified-orthographic`.
- Existing 220x150 TileEditor previews and other unverified atlas images may be used only as optional, bounded POI icons; they never replace a cell's terrain.
- A cell without an authentic terrain image uses the deterministic terrain-type fallback color. It must not borrow, stretch, repeat, or rotate another cell's image.
- POI and location overlays remain user-controlled and default to hidden according to the existing layer state.
- `scrapmechanicmap` is retained only as a capture-quality reference. Its 2020 fixed world is not shipped as a Scrap Mechanic 1.0 default map.

## Data Flow

1. The bundled or uploaded save produces UUID, offsets, rotation, terrain type, and coordinates.
2. `LegacyAssetRepository` loads the verified legacy asset manifest, 1.0 bridge, and optional official atlas.
3. `resolveTerrainVisuals` first resolves authentic legacy POIs and tiles.
4. An official atlas entry may become terrain only when `projection` is `verified-orthographic`.
5. Other official entries can provide an icon overlay, while the cell beneath remains a fallback color.
6. `drawLegacyTerrainFrame` draws fallback terrain first and a bounded icon only when the POI layer is enabled.

## Error Handling

- Missing authentic images remain visible as terrain-colored fallback cells.
- Missing optional official icon pages do not prevent terrain rendering.
- Manifest projection values outside the supported set fail integrity validation.
- Existing asset hashes, dimensions, and canonical-order checks remain mandatory.

## Verification

- Unit tests prove that unverified and isometric entries cannot become terrain.
- Unit tests prove that verified orthographic entries can become terrain.
- Renderer tests prove fallback cells can carry a bounded optional icon without replacing terrain.
- The full unit suite, TypeScript build, and browser smoke tests must pass.
- A local browser inspection must confirm the bundled DB loads on refresh and no large tilted/blurred preview blocks appear in the surface terrain.

