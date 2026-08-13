import type { RegionDefinition } from "../domain/map-model";

const groupOrder: readonly RegionDefinition["group"][] = [
  "surface",
  "story",
  "grow-lab",
  "underground",
  "boss"
];
const groupNames: Record<RegionDefinition["group"], string> = {
  surface: "Surface",
  story: "Story Areas",
  "grow-lab": "Grow Labs",
  underground: "Underground",
  boss: "Boss Areas"
};

export interface RegionSelector {
  render(regions: RegionDefinition[], selectedRegionId?: string): void;
  destroy(): void;
}

export function createRegionSelector(
  root: HTMLElement,
  onRegionChange?: (regionId: string) => void
): RegionSelector {
  const list = document.createElement("div");
  list.className = "region-selector__list";
  root.replaceChildren(list);

  const handleClick = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-region-id]"
    );
    if (button?.dataset.regionId) {
      onRegionChange?.(button.dataset.regionId);
    }
  };

  list.addEventListener("click", handleClick);

  return {
    render(regions, selectedRegionId) {
      const fragment = document.createDocumentFragment();
      for (const groupId of groupOrder) {
        const groupedRegions = regions.filter((region) => region.group === groupId);
        if (groupedRegions.length === 0) {
          continue;
        }

        const group = document.createElement("div");
        group.className = "region-selector__group";
        group.dataset.regionGroup = groupId;
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", groupNames[groupId]);
        const label = document.createElement("span");
        label.className = "region-selector__group-label";
        label.setAttribute("aria-hidden", "true");
        label.textContent = groupNames[groupId];
        const buttons = document.createElement("div");
        buttons.className = "region-selector__group-buttons";

        for (const region of groupedRegions) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "region-selector__button";
          button.dataset.regionId = region.id;
          button.textContent = region.name;
          if (region.id === selectedRegionId) {
            button.setAttribute("aria-current", "true");
          }
          buttons.append(button);
        }
        group.append(label, buttons);
        fragment.append(group);
      }
      list.replaceChildren(fragment);
    },
    destroy() {
      list.removeEventListener("click", handleClick);
      root.replaceChildren();
    }
  };
}
