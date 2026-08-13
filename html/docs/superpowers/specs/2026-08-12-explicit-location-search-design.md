# Explicit Location Search Design

## Goal

Replace live location filtering with an explicit compact search bar and make the default location state show only the Mechanic Station.

## Search interaction

- Remove the visible `SEARCH LOCATIONS` label above the field while preserving an accessible name.
- Render a single row containing the search input, `SEARCH` button, and `×` reset button.
- Typing does not change the active query or visible results.
- Clicking `SEARCH` or pressing Enter applies the current input value.
- Manually clearing the input does not reset the active query.
- Clicking `×` clears the input and restores the initial location state.

## Initial location state

- `Mechanic Station` is selected by default and its map marker is visible.
- Other fixed and generated location types are not selected by default.
- The Location Names directory and its child directories remain visually collapsed by default.
- Reset restores the same default selection: Mechanic Station only.

## Styling

- The input fills the available width.
- `SEARCH` uses the workshop orange border treatment.
- `×` is a compact adjacent reset control with an accessible label.

## Verification

- Component tests cover draft input, explicit submit, Enter submit, and reset.
- Controller/state tests cover the Mechanic Station-only initial and reset state.
- Browser verification confirms no live filtering and correct visible default marker.
