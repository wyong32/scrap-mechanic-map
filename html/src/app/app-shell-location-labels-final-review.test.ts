import { expect, it, vi } from "vitest";
import type { LocationNameInventory } from "../map/location-name-inventory";
import { createAppShell } from "./app-shell";

const inventory: LocationNameInventory = {
  groups: [],
  instances: []
};

it("exposes Player Marker Names as an independent English map layer", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onLayerChange = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, { onLayerChange });
  shell.renderMapLayerTree({
    layerIds: ["labels"],
    inventory,
    selectedLocationTypeIds: [],
    disabled: false
  });

  const checkbox = document.querySelector<HTMLInputElement>(
    "input[data-layer-id='labels']"
  )!;
  expect(checkbox.checked).toBe(true);
  expect(checkbox.closest("label")?.textContent).toContain("Player Marker Names");

  checkbox.click();

  expect(onLayerChange).toHaveBeenCalledWith([]);
  shell.destroy();
});
