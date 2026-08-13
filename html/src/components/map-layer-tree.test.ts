import { beforeEach, expect, it, vi } from "vitest";
import type { LocationNameInventory } from "../map/location-name-inventory";
import { createMapLayerTree } from "./map-layer-tree";

const inventory: LocationNameInventory = {
  groups: [
    {
      id: "fixed-story",
      name: "Fixed & Story Locations",
      count: 1,
      types: [{ id: "fixed:mechanic-station", name: "Mechanic Station", count: 1 }]
    },
    {
      id: "generated",
      name: "Generated Locations",
      count: 2,
      types: [{ id: "generated:warehouse", name: "Warehouse", count: 2 }]
    }
  ],
  instances: []
};

const inventoryWithZeroCount: LocationNameInventory = {
  groups: [
    {
      id: "generated",
      name: "Generated Locations",
      count: 2,
      types: [
        { id: "generated:warehouse", name: "Warehouse", count: 2 },
        { id: "generated:unused", name: "Unused Location", count: 0 }
      ]
    }
  ],
  instances: []
};

beforeEach(() => {
  document.body.innerHTML = '<aside data-testid="map-layer-tree"></aside>';
});

it("renders public layer names and location type counts with names off by default", () => {
  const tree = createMapLayerTree(root(), {});

  tree.render({
    layerIds: ["terrain", "player-markers"],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  expect(layerLabels()).toEqual([
    "Terrain",
    "Player Markers",
    "Player Marker Names",
    "Coordinate Grid",
    "Location Names"
  ]);
  expect(typeRows()).toEqual(["Mechanic Station (1)", "Warehouse (2)"]);
  expect(locationNamesCheckbox().checked).toBe(false);
  expect(root().textContent).not.toContain("generated:warehouse");
});

it("selects only the generated group's available public type IDs", () => {
  const onLocationTypeChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLocationTypeChange });
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  groupCheckbox("generated").click();

  expect(onLocationTypeChange).toHaveBeenCalledWith(["generated:warehouse"]);
});

it("excludes zero-count descendants from master and group selections", () => {
  const onLocationTypeChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLocationTypeChange });
  tree.render({
    layerIds: [],
    inventory: inventoryWithZeroCount,
    selectedLocationTypeIds: [],
    disabled: false
  });

  expect(typeRows()).toEqual(["Warehouse (2)"]);
  locationNamesCheckbox().click();
  expect(onLocationTypeChange).toHaveBeenLastCalledWith(["generated:warehouse"]);

  tree.render({
    layerIds: [],
    inventory: inventoryWithZeroCount,
    selectedLocationTypeIds: [],
    disabled: false
  });
  groupCheckbox("generated").click();
  expect(onLocationTypeChange).toHaveBeenLastCalledWith(["generated:warehouse"]);
});

it("accumulates consecutive type changes before the parent rerenders", () => {
  const onLocationTypeChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLocationTypeChange });
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  typeCheckbox("fixed:mechanic-station").click();
  expect(onLocationTypeChange).toHaveBeenLastCalledWith(["fixed:mechanic-station"]);
  expect(groupCheckbox("fixed-story").checked).toBe(true);
  expect(locationNamesCheckbox().indeterminate).toBe(true);

  typeCheckbox("generated:warehouse").click();
  expect(onLocationTypeChange).toHaveBeenLastCalledWith([
    "fixed:mechanic-station",
    "generated:warehouse"
  ]);
  expect(groupCheckbox("generated").checked).toBe(true);
  expect(locationNamesCheckbox().checked).toBe(true);

  groupCheckbox("generated").click();
  expect(onLocationTypeChange).toHaveBeenLastCalledWith(["fixed:mechanic-station"]);
  expect(typeCheckbox("generated:warehouse").checked).toBe(false);
  expect(locationNamesCheckbox().indeterminate).toBe(true);

  locationNamesCheckbox().click();
  expect(onLocationTypeChange).toHaveBeenLastCalledWith([
    "fixed:mechanic-station",
    "generated:warehouse"
  ]);
  expect(typeCheckbox("generated:warehouse").checked).toBe(true);
});

it("shows indeterminate master state after a selected Warehouse is cleared", () => {
  const tree = createMapLayerTree(root(), {});
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: ["fixed:mechanic-station", "generated:warehouse"],
    disabled: false
  });

  typeCheckbox("generated:warehouse").click();
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: ["fixed:mechanic-station"],
    disabled: false
  });

  expect(locationNamesCheckbox().indeterminate).toBe(true);
  expect(groupCheckbox("fixed-story").checked).toBe(true);
  expect(groupCheckbox("generated").checked).toBe(false);
});

it("changes disclosure state without changing selected types", () => {
  const onLocationTypeChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLocationTypeChange });
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: ["generated:warehouse"],
    disabled: false
  });

  locationMasterDisclosure().click();
  const disclosure = disclosureButton("generated");
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  disclosure.click();

  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(onLocationTypeChange).not.toHaveBeenCalled();

  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: ["generated:warehouse"],
    disabled: false
  });

  expect(disclosureButton("generated").getAttribute("aria-expanded")).toBe("true");
});

it("omits empty groups and disables the no-location-data master", () => {
  const tree = createMapLayerTree(root(), {});
  tree.render({
    layerIds: [],
    inventory: { groups: [], instances: [] },
    selectedLocationTypeIds: [],
    disabled: false
  });

  expect(root().textContent).toContain("No location data");
  expect(locationNamesCheckbox().disabled).toBe(true);
  expect(root().querySelector("[data-location-group-id]")).toBeNull();
});

it("emits stable sorted ordinary layer IDs and restores type focus after rerender", () => {
  const onLayerChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLayerChange });
  tree.render({
    layerIds: ["terrain"],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  locationMasterDisclosure().click();
  disclosureButton("generated").click();
  typeCheckbox("generated:warehouse").focus();
  layerCheckbox("grid").click();
  tree.render({
    layerIds: ["terrain", "grid"],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  expect(onLayerChange).toHaveBeenCalledWith(["grid", "terrain"]);
  expect(document.activeElement).toBe(typeCheckbox("generated:warehouse"));
});

it("restores group checkbox focus to the checkbox rather than its disclosure", () => {
  const tree = createMapLayerTree(root(), {});
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  locationMasterDisclosure().click();
  groupCheckbox("generated").focus();
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: ["generated:warehouse"],
    disabled: false
  });

  expect(document.activeElement).toBe(groupCheckbox("generated"));

  disclosureButton("generated").focus();
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: ["generated:warehouse"],
    disabled: false
  });

  expect(document.activeElement).toBe(disclosureButton("generated"));
});

it("disables every interactive control during transitions", () => {
  const onLayerChange = vi.fn();
  const onLocationTypeChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLayerChange, onLocationTypeChange });
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: true
  });

  const controls = Array.from(
    root().querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")
  );
  expect(controls.length).toBeGreaterThan(0);
  expect(controls.every((control) => control.disabled)).toBe(true);
  controls.forEach((control) => control.click());
  expect(onLayerChange).not.toHaveBeenCalled();
  expect(onLocationTypeChange).not.toHaveBeenCalled();
});

it("removes delegated listeners and rendered controls when destroyed", () => {
  const onLayerChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLayerChange });
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  tree.destroy();
  expect(root().childElementCount).toBe(0);

  const detachedCheck = document.createElement("input");
  detachedCheck.type = "checkbox";
  detachedCheck.dataset.layerId = "grid";
  root().append(detachedCheck);
  detachedCheck.click();
  expect(onLayerChange).not.toHaveBeenCalled();
});

function root(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-testid='map-layer-tree']")!;
}

function layerLabels(): string[] {
  return Array.from(root().querySelectorAll<HTMLElement>("[data-layer-label]"))
    .map((element) => element.textContent ?? "");
}

function typeRows(): string[] {
  return Array.from(root().querySelectorAll<HTMLElement>("[data-location-type-row]"))
    .map((element) => element.textContent ?? "");
}

function locationNamesCheckbox(): HTMLInputElement {
  return root().querySelector<HTMLInputElement>("input[data-location-master]")!;
}

function layerCheckbox(id: string): HTMLInputElement {
  return root().querySelector<HTMLInputElement>(`input[data-layer-id="${id}"]`)!;
}

function groupCheckbox(id: string): HTMLInputElement {
  return root().querySelector<HTMLInputElement>(
    `input[data-location-group-id="${id}"]`
  )!;
}

function typeCheckbox(id: string): HTMLInputElement {
  return root().querySelector<HTMLInputElement>(
    `input[data-location-type-id="${id}"]`
  )!;
}

function disclosureButton(id: string): HTMLButtonElement {
  return root().querySelector<HTMLButtonElement>(
    `button[data-location-disclosure-id="${id}"]`
  )!;
}

function locationMasterDisclosure(): HTMLButtonElement {
  return root().querySelector<HTMLButtonElement>(
    "button[data-location-master-disclosure]"
  )!;
}
