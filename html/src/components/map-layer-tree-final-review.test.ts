import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

beforeEach(() => {
  document.body.innerHTML = '<aside data-testid="map-layer-tree"></aside>';
});

it("starts every location branch collapsed and keeps disclosure after its label", () => {
  const onLocationTypeChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLocationTypeChange });
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: ["fixed:mechanic-station"],
    disabled: false
  });

  const master = locationMaster();
  const disclosure = locationDisclosure();
  expect(master.indeterminate).toBe(true);
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(disclosure.textContent).toBe("▸");
  expect(disclosure.getAttribute("aria-label")).toBe("Expand Location Names");
  expect(locationChildren().hidden).toBe(true);
  expect(locationMaster().parentElement?.nextElementSibling).toBe(disclosure);

  disclosure.click();

  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(disclosure.textContent).toBe("▾");
  expect(disclosure.getAttribute("aria-label")).toBe("Collapse Location Names");
  expect(locationChildren().hidden).toBe(false);
  expect(groupDisclosure("fixed-story").getAttribute("aria-expanded")).toBe("false");
  expect(groupDisclosure("generated").getAttribute("aria-expanded")).toBe("false");
  expect(groupDisclosure("fixed-story").parentElement?.lastElementChild)
    .toBe(groupDisclosure("fixed-story"));
  expect(groupDisclosure("generated").parentElement?.lastElementChild)
    .toBe(groupDisclosure("generated"));
  expect(typeCheckbox("fixed:mechanic-station").closest("[hidden]")).not.toBeNull();
  expect(master.indeterminate).toBe(true);
  expect(onLocationTypeChange).not.toHaveBeenCalled();

  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: ["fixed:mechanic-station"],
    disabled: false
  });

  expect(locationDisclosure().getAttribute("aria-expanded")).toBe("true");
  expect(locationChildren().hidden).toBe(false);
  expect(locationMaster().indeterminate).toBe(true);
});

it("ships full-width rows with disclosure buttons aligned at the end", () => {
  const css = readFileSync(join(process.cwd(), "src", "styles", "app.css"), "utf8");
  expect(css).toMatch(/\.map-layer-tree__location-master[\s\S]*?width:\s*100%/);
  expect(css).toMatch(/\.map-layer-tree__group\s*>\s*div:first-child[\s\S]*?width:\s*100%/);
  expect(css).toMatch(/\.map-layer-tree__location-master\s*>\s*button[\s\S]*?margin-left:\s*auto/);
  expect(css).toMatch(/\.map-layer-tree__group\s*>\s*div:first-child\s*>\s*button[\s\S]*?margin-left:\s*auto/);
  expect(css).toMatch(/\[data-location-master-children\]\[hidden\][\s\S]*?display:\s*none/);
  expect(css).toMatch(/\[data-location-group-children\]\[hidden\][\s\S]*?display:\s*none/);
  expect(css).toMatch(/\[data-location-master-children\]\s*>\s*\.map-layer-tree__group[\s\S]*?margin-left:\s*0\.75rem/);
  expect(css).toMatch(/\[data-location-group-children\][\s\S]*?padding-left:\s*1\.65rem/);
});

it("moves focus over visible controls and explicitly activates buttons and checkboxes", () => {
  const onLocationTypeChange = vi.fn();
  const tree = createMapLayerTree(root(), { onLocationTypeChange });
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  locationDisclosure().click();
  locationMaster().focus();
  press(locationMaster(), "ArrowDown");
  expect(document.activeElement).toBe(locationDisclosure());
  press(locationDisclosure(), "ArrowDown");
  expect(document.activeElement).toBe(groupCheckbox("fixed-story"));
  press(groupCheckbox("fixed-story"), "ArrowDown");
  expect(document.activeElement).toBe(groupDisclosure("fixed-story"));
  groupDisclosure("fixed-story").click();
  press(groupDisclosure("fixed-story"), "ArrowDown");
  expect(document.activeElement).toBe(typeCheckbox("fixed:mechanic-station"));
  press(typeCheckbox("fixed:mechanic-station"), "ArrowUp");
  expect(document.activeElement).toBe(groupDisclosure("fixed-story"));

  press(groupCheckbox("fixed-story"), " ");
  expect(onLocationTypeChange).toHaveBeenLastCalledWith(["fixed:mechanic-station"]);

  locationDisclosure().focus();
  press(locationDisclosure(), " ");
  expect(locationDisclosure().getAttribute("aria-expanded")).toBe("false");
  press(locationDisclosure(), "Enter");
  expect(locationDisclosure().getAttribute("aria-expanded")).toBe("true");
});

it("restores retained focus exactly and uses deterministic fallbacks for vanished types", () => {
  const tree = createMapLayerTree(root(), {});
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  locationDisclosure().click();
  groupDisclosure("generated").click();
  locationDisclosure().focus();
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });
  expect(document.activeElement).toBe(locationDisclosure());

  groupDisclosure("generated").click();
  typeCheckbox("generated:warehouse").focus();
  tree.render({
    layerIds: [],
    inventory: {
      ...inventory,
      groups: [
        inventory.groups[0]!,
        {
          id: "generated",
          name: "Generated Locations",
          count: 1,
          types: [{ id: "generated:trader", name: "Trader", count: 1 }]
        }
      ]
    },
    selectedLocationTypeIds: [],
    disabled: false
  });
  expect(document.activeElement).toBe(groupCheckbox("generated"));

  typeCheckbox("generated:trader").focus();
  tree.render({
    layerIds: [],
    inventory: { groups: [inventory.groups[0]!], instances: [] },
    selectedLocationTypeIds: [],
    disabled: false
  });
  expect(document.activeElement).toBe(locationMaster());
});

it("keeps type focus intent across a disabled world transition before applying fallback", () => {
  const tree = createMapLayerTree(root(), {});
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  typeCheckbox("generated:warehouse").focus();
  tree.render({
    layerIds: [],
    inventory,
    selectedLocationTypeIds: [],
    disabled: true
  });
  tree.render({
    layerIds: [],
    inventory: { groups: [inventory.groups[0]!], instances: [] },
    selectedLocationTypeIds: [],
    disabled: false
  });

  expect(document.activeElement).toBe(locationMaster());
});

function root(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-testid='map-layer-tree']")!;
}

function locationMaster(): HTMLInputElement {
  return root().querySelector<HTMLInputElement>("input[data-location-master]")!;
}

function locationDisclosure(): HTMLButtonElement {
  return root().querySelector<HTMLButtonElement>("button[data-location-master-disclosure]")!;
}

function locationChildren(): HTMLElement {
  return root().querySelector<HTMLElement>("[data-location-master-children]")!;
}

function groupDisclosure(id: string): HTMLButtonElement {
  return root().querySelector<HTMLButtonElement>(
    `button[data-location-disclosure-id="${id}"]`
  )!;
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

function press(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true
  }));
}
