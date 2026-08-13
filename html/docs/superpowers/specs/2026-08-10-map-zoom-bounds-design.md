# Map Zoom Bounds Design

## Goal

Keep the default surface map readable and prevent zooming beyond useful visual detail.

## Behavior

- The minimum zoom is `-5`, matching the current initial full-map presentation.
- The maximum zoom is `0`, approximately matching the useful native detail of the 10775 x 8480 reference image.
- Zoom changes remain in single Leaflet zoom levels.
- Zoom Out is disabled at `-5`; Zoom In is disabled at `0`.
- Map gestures, buttons, restored URLs, and serialized URLs all share the same bounds.
- A URL zoom below `-5` is clamped to `-5`; a URL zoom above `0` is clamped to `0`.
- Existing center coordinates, layers, labels, player markers, save maps, and fixed regions are unchanged.

## Implementation

- Update the shared `MIN_MAP_ZOOM` and `MAX_MAP_ZOOM` constants.
- Clamp parsed URL zoom values to the shared range instead of replacing an out-of-range value with an unrelated default.
- Keep the existing Leaflet configuration and map-control disabled logic driven by those shared constants.

## Verification

- Unit tests cover both zoom buttons at their limits.
- URL parsing tests cover lower and upper clamping.
- Map-view tests confirm repeated zoom calls cannot exceed either limit.
- Controller tests confirm the readout and URL stop at the configured bounds.
- Production build must pass.
