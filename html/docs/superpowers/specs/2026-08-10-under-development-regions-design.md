# Under-Development Region Pages Design

## Goal

Prevent unfinished region pages from displaying temporary, reference, or misleading maps. Surface World remains the only currently available interactive region. Every other region remains visible in the top navigation but opens a clear under-development page.

## Availability Rule

- `surface` is the only available region.
- Every other current region ID is unavailable, including Scrapyard, Excavation Island, Grow Labs 1–7, Mining Hub, Underground Stations, Drilling Areas, Underground Guidance Area, and boss regions.
- Availability is defined in one explicit checked-in allowlist so a completed region can be enabled later without changing the presentation rules.
- Unknown or future region IDs fail closed and use the under-development page until explicitly enabled.

## User Experience

The top region navigation remains visible for both available and unavailable regions.

When an unavailable region is selected:

- the selected tab remains visibly active;
- the URL records only the public region ID;
- the normal map canvas and map controls are not rendered;
- the left location/search/sidebar content and right location details are hidden;
- the main content displays `Under Development` and `This region map is not available yet.`;
- no temporary reference image, fixed-region placeholder, POI label, or player marker is shown.

When Surface World is selected again, the normal three-column interactive map view returns with its existing state rules.

## Architecture

Add a small region-availability policy with `isRegionAvailable(regionId)`. The application controller consults it before requesting a world. For unavailable regions it updates canonical public URL state and instructs the shell to render its under-development mode without calling the repository or map renderer.

The shell owns presentation only: it toggles between the normal map workspace and a semantic development placeholder. The controller owns availability decisions and transition cancellation so an older asynchronous Surface World load cannot overwrite a newer unavailable-region selection.

## State and Navigation

- Selecting an unavailable region cancels pending world/save transitions.
- Private save information is never added to the URL or placeholder.
- Map-specific query parameters may be normalized away for unavailable regions because no map viewport or layer state is active there.
- Browser back/forward navigation uses the same availability rule.
- Returning to Surface World performs the normal world commit and restores supported map behavior.

## Accessibility

- The placeholder uses a heading and explanatory paragraph.
- Unavailable tabs remain ordinary navigable region buttons; they are not disabled because their destination page is intentional.
- Focus remains on the selected region button after activation.
- No hidden map control remains keyboard-focusable while the placeholder is active.

## Testing

Controller tests must prove that unavailable regions do not call `loadWorld`, cancel stale transitions, update the public URL, and return safely to Surface World. Shell tests must prove that the map, sidebars, and controls are absent or hidden in development mode and restored in map mode. Browser acceptance must verify at least one unavailable region and the round trip back to Surface World.

## Non-Goals

- Rendering or acquiring maps for unfinished regions.
- Removing unfinished regions from navigation.
- Changing Surface World terrain, save import, location filters, or player marker behavior.
- Translating the English interface.
