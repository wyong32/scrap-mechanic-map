# Collapsible Left Sidebar Design

## Goal

Let desktop and tablet users collapse the left Location Browser into a narrow rail so the map gains horizontal space, then restore the full sidebar with one click.

## Scope

- Apply at viewport widths of 760px and above, where the application uses a persistent left column.
- Preserve the existing mobile drawer behavior below 760px.
- Do not change the right Location Details panel.
- Do not alter map data, filters, save import, player markers, or URL state.

## Interaction

- Add a dedicated sidebar toggle button at the upper-right edge of the left panel.
- Expanded state uses the existing 280px column, or 320px at widths of 1100px and above.
- Collapsed state uses a 40px rail.
- The expanded button shows `‹` and has the accessible name `Collapse location sidebar`.
- The collapsed button shows `›` and has the accessible name `Expand location sidebar`.
- The button exposes `aria-expanded` and `aria-controls="location-panel"`.
- Collapsing hides the Location Browser and save controls from layout, focus, and assistive technology while keeping only the rail and toggle visible.
- Expanding restores the sidebar content without resetting search text, filters, scroll position, selected location, or player-marker editing state.
- The grid-column width and panel content transition over 180ms. Under `prefers-reduced-motion: reduce`, transitions are disabled.

## Persistence

- Store the desktop collapsed state in `localStorage` under a versioned application-owned key.
- Read the value defensively during shell creation. Missing, malformed, or inaccessible storage defaults to expanded.
- Storage write failures must not block the toggle or show a user-facing error.
- Mobile drawer state is not persisted and does not overwrite the desktop preference.

## Architecture

`createAppShell` owns the UI state because it already owns the location panel and mobile drawer. It initializes the preference, updates a `data-location-panel-collapsed` attribute on `.app-shell`, synchronizes the toggle button, and installs one click listener. CSS derives column width, visibility, and transition behavior from that attribute. No controller or domain-model changes are required.

After any desktop state change, dispatch a window `resize` event so Leaflet recalculates the enlarged or reduced map viewport. The listener and scheduled work are cleaned up by the existing shell `destroy()` lifecycle.

## Responsive behavior

- Desktop/tablet (`min-width: 760px`): the toggle controls the persistent left column.
- Mobile (`max-width: 759px`): the desktop toggle is hidden and the existing location drawer remains authoritative.
- Crossing breakpoints does not erase the stored desktop preference. Returning to desktop restores it.

## Testing

- App-shell unit tests cover default expanded state, collapse/expand behavior, accessible attributes, persistence, storage failures, preservation of sidebar controls, resize notification, and mobile isolation.
- CSS/browser verification confirms the left rail is 40px when collapsed and the map column expands.
- Existing app, map, marker, save, lint, and build checks must remain green except for the already-known default-surface capture inventory baseline failures.
