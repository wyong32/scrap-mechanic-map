# Location Name Disclosure Layout Design

## Goal

Make the Location Names tree compact and visually hierarchical without changing map-layer selection or POI data.

## Row Layout

Every expandable row uses this order:

1. selection checkbox;
2. English label and visible-instance count;
3. disclosure button aligned to the far right.

The disclosure button uses a right-pointing arrow while collapsed and a down-pointing arrow while expanded. It keeps an English accessible name such as `Expand Location Names` or `Collapse Generated Locations`.

## Hierarchy and Initial State

`Location Names` is the first-level row. Its children are hidden on initial render.

After the first-level row is expanded, the second-level rows `Fixed & Story Locations` and `Generated Locations` appear. Both second-level rows are initially collapsed, so their third-level type rows remain hidden until the corresponding second-level disclosure button is activated.

Expansion state is retained across ordinary rerenders for the lifetime of the component. A new component instance starts with all expandable rows collapsed.

## Selection Behaviour

Disclosure and selection remain independent:

- activating an arrow only expands or collapses descendants;
- checking a parent selects its available descendants;
- collapsing a selected branch does not clear its selection;
- tri-state checkbox behaviour is unchanged;
- player-marker layer controls and map POI rendering are unchanged.

## Keyboard and Accessibility

Disclosure buttons remain native buttons with `aria-expanded`, `aria-controls` where applicable, and an English `aria-label`. Hidden descendants are excluded from arrow-key navigation. Focus restoration continues to prefer the same logical control after rerender.

## Verification

Component tests will prove:

- all disclosure rows start collapsed;
- buttons follow labels in DOM order and align to the row end;
- expanding level one reveals only level two;
- expanding a level-two row reveals its level-three children;
- disclosure operations do not change selected location types;
- keyboard navigation skips hidden descendants and follows visible row order.

