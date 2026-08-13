import type { LocationNameInventory } from "../map/location-name-inventory";

const ordinaryLayers = [
  { id: "terrain", name: "Terrain" },
  { id: "player-markers", name: "Player Markers" },
  { id: "labels", name: "Player Marker Names" },
  { id: "grid", name: "Coordinate Grid" }
] as const;

export interface MapLayerTreeRenderInput {
  layerIds: readonly string[];
  inventory: LocationNameInventory;
  selectedLocationTypeIds: readonly string[];
  disabled: boolean;
}

export interface MapLayerTreeCallbacks {
  onLayerChange?(layerIds: string[]): void;
  onLocationTypeChange?(typeIds: string[]): void;
}

export interface MapLayerTree {
  render(input: MapLayerTreeRenderInput): void;
  destroy(): void;
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right, "en"));
}

function availableGroupTypeIds(
  group: LocationNameInventory["groups"][number]
): string[] {
  if (group.count === 0) return [];
  return group.types.filter((type) => type.count > 0).map((type) => type.id);
}

function availableTypeIds(inventory: LocationNameInventory): string[] {
  return sortedIds(inventory.groups.flatMap(availableGroupTypeIds));
}

function selectedCount(ids: readonly string[], selected: ReadonlySet<string>): number {
  return ids.filter((id) => selected.has(id)).length;
}

function setCheckboxState(
  checkbox: HTMLInputElement,
  ids: readonly string[],
  selected: ReadonlySet<string>
): void {
  const selectedTypes = selectedCount(ids, selected);
  checkbox.checked = ids.length > 0 && selectedTypes === ids.length;
  checkbox.indeterminate = selectedTypes > 0 && selectedTypes < ids.length;
}

type FocusedControl =
  | { kind: "layer"; id: string }
  | { kind: "location-master" }
  | { kind: "location-master-disclosure" }
  | { kind: "location-group"; id: string }
  | { kind: "location-disclosure"; id: string }
  | { kind: "location-type"; id: string; groupId?: string };

export function createMapLayerTree(
  root: HTMLElement,
  callbacks: MapLayerTreeCallbacks
): MapLayerTree {
  let input: MapLayerTreeRenderInput | undefined;
  let selectedLocationTypeIds = new Set<string>();
  const collapsedGroups = new Set<string>(["fixed-story", "generated"]);
  let locationNamesExpanded = false;
  let pendingFocus: FocusedControl | undefined;

  const findControl = <T extends HTMLInputElement | HTMLButtonElement>(
    predicate: (control: T) => boolean
  ): T | undefined =>
    Array.from(root.querySelectorAll<T>("input, button")).find(predicate);

  const focusControl = (
    control: HTMLInputElement | HTMLButtonElement | undefined
  ): boolean => {
    if (!control || control.disabled || control.closest("[hidden]")) return false;
    control.focus({ preventScroll: true });
    return true;
  };

  const getFocusedControl = (): FocusedControl | undefined => {
    const activeElement = root.ownerDocument.activeElement;
    if (!(activeElement instanceof HTMLElement) || !root.contains(activeElement)) {
      return undefined;
    }
    if (activeElement instanceof HTMLInputElement) {
      if (activeElement.dataset.layerId) {
        return { kind: "layer", id: activeElement.dataset.layerId };
      }
      if (activeElement.dataset.locationMaster !== undefined) {
        return { kind: "location-master" };
      }
      if (activeElement.dataset.locationGroupId) {
        return { kind: "location-group", id: activeElement.dataset.locationGroupId };
      }
      if (activeElement.dataset.locationTypeId) {
        const id = activeElement.dataset.locationTypeId;
        const groupId = input?.inventory.groups.find((group) =>
          group.types.some((type) => type.id === id)
        )?.id;
        return { kind: "location-type", id, groupId };
      }
    }
    if (activeElement instanceof HTMLButtonElement) {
      if (activeElement.dataset.locationMasterDisclosure !== undefined) {
        return { kind: "location-master-disclosure" };
      }
      if (activeElement.dataset.locationDisclosureId) {
        return {
          kind: "location-disclosure",
          id: activeElement.dataset.locationDisclosureId
        };
      }
    }
    return undefined;
  };

  const focusLocationMaster = (): boolean =>
    focusControl(findControl<HTMLInputElement>(
      (control) => control.dataset.locationMaster !== undefined
    )) || focusControl(findControl<HTMLButtonElement>(
      (control) => control.dataset.locationMasterDisclosure !== undefined
    ));

  const restoreFocus = (focusedControl: FocusedControl | undefined): void => {
    if (!focusedControl) return;
    if (focusedControl.kind === "layer") {
      focusControl(findControl<HTMLInputElement>(
        (control) => control.dataset.layerId === focusedControl.id
      ));
      return;
    }
    if (focusedControl.kind === "location-master") {
      if (!focusControl(findControl<HTMLInputElement>(
        (control) => control.dataset.locationMaster !== undefined
      ))) {
        focusControl(findControl<HTMLButtonElement>(
          (control) => control.dataset.locationMasterDisclosure !== undefined
        ));
      }
      return;
    }
    if (focusedControl.kind === "location-master-disclosure") {
      if (!focusControl(findControl<HTMLButtonElement>(
        (control) => control.dataset.locationMasterDisclosure !== undefined
      ))) {
        focusControl(findControl<HTMLInputElement>(
          (control) => control.dataset.locationMaster !== undefined
        ));
      }
      return;
    }
    if (focusedControl.kind === "location-type") {
      if (focusControl(findControl<HTMLInputElement>(
        (control) => control.dataset.locationTypeId === focusedControl.id
      ))) {
        return;
      }
      if (focusedControl.groupId && focusControl(findControl<HTMLInputElement>(
        (control) => control.dataset.locationGroupId === focusedControl.groupId
      ))) {
        return;
      }
      if (focusedControl.groupId && focusControl(findControl<HTMLButtonElement>(
        (control) => control.dataset.locationDisclosureId === focusedControl.groupId
      ))) {
        return;
      }
      focusLocationMaster();
      return;
    }
    if (focusedControl.kind === "location-group") {
      if (focusControl(findControl<HTMLInputElement>(
        (control) => control.dataset.locationGroupId === focusedControl.id
      ))) {
        return;
      }
      focusLocationMaster();
      return;
    }
    if (focusControl(findControl<HTMLButtonElement>(
      (control) => control.dataset.locationDisclosureId === focusedControl.id
    ))) {
      return;
    }
    focusLocationMaster();
  };

  const syncLocationSelection = () => {
    if (!input) return;
    const availableIds = availableTypeIds(input.inventory);
    for (const checkbox of root.querySelectorAll<HTMLInputElement>(
      "input[data-location-type-id]"
    )) {
      checkbox.checked = selectedLocationTypeIds.has(checkbox.dataset.locationTypeId!);
    }
    const master = root.querySelector<HTMLInputElement>("input[data-location-master]");
    if (master) setCheckboxState(master, availableIds, selectedLocationTypeIds);
    for (const group of input.inventory.groups) {
      const checkbox = root.querySelector<HTMLInputElement>(
        `input[data-location-group-id="${group.id}"]`
      );
      if (checkbox) {
        setCheckboxState(
          checkbox,
          availableGroupTypeIds(group),
          selectedLocationTypeIds
        );
      }
    }
  };

  const emitLocationTypeChange = () => {
    syncLocationSelection();
    callbacks.onLocationTypeChange?.(sortedIds(selectedLocationTypeIds));
  };

  const handleChange = (event: Event) => {
    if (!input || !(event.target instanceof HTMLInputElement)) return;

    if (event.target.dataset.layerId) {
      const layerIds = Array.from(
        root.querySelectorAll<HTMLInputElement>("input[data-layer-id]:checked")
      ).map((checkbox) => checkbox.dataset.layerId!);
      callbacks.onLayerChange?.(sortedIds(layerIds));
      return;
    }

    const availableIds = availableTypeIds(input.inventory);

    if (event.target.dataset.locationMaster !== undefined) {
      selectedLocationTypeIds = new Set(event.target.checked ? availableIds : []);
      emitLocationTypeChange();
      return;
    }

    const groupId = event.target.dataset.locationGroupId;
    if (groupId) {
      const group = input.inventory.groups.find((candidate) => candidate.id === groupId);
      if (!group) return;
      const groupTypeIds = availableGroupTypeIds(group);
      for (const typeId of groupTypeIds) {
        if (event.target.checked) selectedLocationTypeIds.add(typeId);
        else selectedLocationTypeIds.delete(typeId);
      }
      emitLocationTypeChange();
      return;
    }

    const typeId = event.target.dataset.locationTypeId;
    if (!typeId || !availableIds.includes(typeId)) return;
    if (event.target.checked) selectedLocationTypeIds.add(typeId);
    else selectedLocationTypeIds.delete(typeId);
    emitLocationTypeChange();
  };

  const handleClick = (event: Event) => {
    const masterDisclosure = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-location-master-disclosure]"
    );
    if (masterDisclosure && !masterDisclosure.disabled) {
      locationNamesExpanded = !locationNamesExpanded;
      syncDisclosure(masterDisclosure, locationNamesExpanded, "Location Names");
      root.querySelector<HTMLElement>("[data-location-master-children]")!.hidden =
        !locationNamesExpanded;
      return;
    }
    const disclosure = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-location-disclosure-id]"
    );
    if (!disclosure || disclosure.disabled) return;
    const groupId = disclosure.dataset.locationDisclosureId!;
    const isExpanded = disclosure.getAttribute("aria-expanded") === "true";
    const groupName = disclosure.getAttribute("aria-label")
      ?.replace(/^(Collapse|Expand) /, "") ?? groupId;
    syncDisclosure(disclosure, !isExpanded, groupName);
    root.querySelector<HTMLElement>(`[data-location-group-children="${groupId}"]`)!
      .hidden = isExpanded;
    if (isExpanded) collapsedGroups.add(groupId);
    else collapsedGroups.delete(groupId);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLButtonElement)) {
      return;
    }
    const visibleControls = Array.from(
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")
    ).filter((control) => !control.disabled && !control.closest("[hidden]"));
    const currentIndex = visibleControls.indexOf(target);
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0;
    if (direction !== 0 && currentIndex >= 0) {
      event.preventDefault();
      visibleControls[(currentIndex + direction + visibleControls.length) % visibleControls.length]
        ?.focus({ preventScroll: true });
      return;
    }
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      if (event.key === " ") {
        event.preventDefault();
        target.click();
      } else if (event.key === "Enter") {
        event.preventDefault();
      }
      return;
    }
    if (target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      target.click();
    }
  };

  root.addEventListener("change", handleChange);
  root.addEventListener("click", handleClick);
  root.addEventListener("keydown", handleKeyDown);

  return {
    render(nextInput) {
      const focusedControl = getFocusedControl() ?? pendingFocus;
      input = nextInput;

      const document = root.ownerDocument;
      const selectedLayerIds = new Set(nextInput.layerIds);
      const availableIds = availableTypeIds(nextInput.inventory);
      selectedLocationTypeIds = new Set(
        nextInput.selectedLocationTypeIds.filter((id) => availableIds.includes(id))
      );
      const fragment = document.createDocumentFragment();
      const fieldset = document.createElement("fieldset");
      fieldset.className = "map-layer-tree";
      const legend = document.createElement("legend");
      legend.textContent = "Map Layers";
      fieldset.append(legend);

      for (const layer of ordinaryLayers) {
        const label = document.createElement("label");
        label.className = "map-layer-tree__layer";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.layerId = layer.id;
        checkbox.checked = selectedLayerIds.has(layer.id);
        checkbox.disabled = nextInput.disabled;
        const text = document.createElement("span");
        text.dataset.layerLabel = "";
        text.textContent = layer.name;
        label.append(checkbox, text);
        fieldset.append(label);
      }

      const masterRow = document.createElement("div");
      masterRow.className = "map-layer-tree__location-master";
      const masterDisclosure = document.createElement("button");
      masterDisclosure.type = "button";
      masterDisclosure.dataset.locationMasterDisclosure = "";
      masterDisclosure.setAttribute("aria-controls", "location-name-tree-children");
      syncDisclosure(masterDisclosure, locationNamesExpanded, "Location Names");
      masterDisclosure.disabled = nextInput.disabled || availableIds.length === 0;
      const masterLabel = document.createElement("label");
      const master = document.createElement("input");
      master.type = "checkbox";
      master.dataset.locationMaster = "";
      master.disabled = nextInput.disabled || availableIds.length === 0;
      const masterText = document.createElement("span");
      masterText.dataset.layerLabel = "";
      masterText.textContent = availableIds.length === 0
        ? "Location Names — No location data"
        : "Location Names";
      masterLabel.append(master, masterText);
      masterRow.append(masterLabel, masterDisclosure);
      fieldset.append(masterRow);

      const locationChildren = document.createElement("div");
      locationChildren.id = "location-name-tree-children";
      locationChildren.dataset.locationMasterChildren = "";
      locationChildren.hidden = !locationNamesExpanded;
      for (const group of nextInput.inventory.groups) {
        if (group.types.length === 0 || group.count === 0) continue;
        const groupRow = document.createElement("div");
        groupRow.className = "map-layer-tree__group";
        const groupHeader = document.createElement("div");
        const disclosure = document.createElement("button");
        disclosure.type = "button";
        disclosure.dataset.locationDisclosureId = group.id;
        const isExpanded = !collapsedGroups.has(group.id);
        syncDisclosure(disclosure, isExpanded, group.name);
        disclosure.disabled = nextInput.disabled;

        const groupLabel = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.locationGroupId = group.id;
        checkbox.disabled = nextInput.disabled;
        const text = document.createElement("span");
        text.textContent = `${group.name} (${group.count})`;
        groupLabel.append(checkbox, text);
        groupHeader.append(groupLabel, disclosure);

        const children = document.createElement("div");
        children.dataset.locationGroupChildren = group.id;
        children.hidden = !isExpanded;
        for (const type of group.types) {
          if (type.count === 0) continue;
          const typeRow = document.createElement("label");
          typeRow.dataset.locationTypeRow = "";
          const typeCheckbox = document.createElement("input");
          typeCheckbox.type = "checkbox";
          typeCheckbox.dataset.locationTypeId = type.id;
          typeCheckbox.checked = selectedLocationTypeIds.has(type.id);
          typeCheckbox.disabled = nextInput.disabled;
          const typeText = document.createElement("span");
          typeText.textContent = `${type.name} (${type.count})`;
          typeRow.append(typeCheckbox, typeText);
          children.append(typeRow);
        }
        groupRow.append(groupHeader, children);
        locationChildren.append(groupRow);
      }
      fieldset.append(locationChildren);

      fragment.append(fieldset);
      root.replaceChildren(fragment);
      syncLocationSelection();

      restoreFocus(focusedControl);
      pendingFocus = focusedControl && !getFocusedControl()
        ? focusedControl
        : undefined;
    },
    destroy() {
      root.removeEventListener("change", handleChange);
      root.removeEventListener("click", handleClick);
      root.removeEventListener("keydown", handleKeyDown);
      root.replaceChildren();
    }
  };
}

function syncDisclosure(
  button: HTMLButtonElement,
  expanded: boolean,
  label: string
): void {
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${label}`);
  button.textContent = expanded ? "▾" : "▸";
}
