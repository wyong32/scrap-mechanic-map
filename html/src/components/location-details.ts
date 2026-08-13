import type { MapLocation } from "../domain/map-model";
import { getCategoryLabel, getPrecisionLabel } from "./location-browser";

const detailsHeading = "Location Details";
const emptyDetails = "Select a map marker or list item to view details.";
const categoryLabel = "Category";
const precisionLabel = "Location Accuracy";
const coordinatesLabel = "Coordinates";
const relatedLabel = "Related Regions";
const questsLabel = "Quests";
const resourcesLabel = "Resources";
const enemiesLabel = "Enemies";

export interface LocationDetails {
  render(location?: MapLocation, regionNames?: ReadonlyMap<string, string>): void;
  destroy(): void;
}

export function createLocationDetails(root: HTMLElement): LocationDetails {
  return {
    render(location, regionNames) {
      root.dataset.hasSelection = String(Boolean(location));
      if (!location) {
        const heading = document.createElement("h2");
        heading.textContent = detailsHeading;
        const empty = document.createElement("p");
        empty.className = "detail-panel__empty";
        empty.textContent = emptyDetails;
        root.replaceChildren(heading, empty);
        return;
      }

      const eyebrow = document.createElement("p");
      eyebrow.className = "detail-panel__eyebrow";
      eyebrow.textContent = detailsHeading;
      const heading = document.createElement("h2");
      heading.textContent = location.name;
      const dataList = document.createElement("dl");
      dataList.className = "detail-list";

      const category = appendDetail(
        dataList,
        categoryLabel,
        getCategoryLabel(location.category)
      );
      category.dataset.category = location.category;
      const precision = appendDetail(
        dataList,
        precisionLabel,
        getPrecisionLabel(location.precision)
      );
      precision.dataset.precision = location.precision;
      if (location.position) {
        appendDetail(
          dataList,
          coordinatesLabel,
          `${location.position.x}, ${location.position.y}${location.position.z === undefined ? "" : `, ${location.position.z}`}`
        );
      }
      appendIds(dataList, questsLabel, location.questIds);
      appendIds(dataList, resourcesLabel, location.resourceIds);
      appendIds(dataList, enemiesLabel, location.enemyIds);
      if (location.relatedRegionIds.length > 0) {
        appendRelatedRegions(dataList, location.relatedRegionIds, regionNames);
      }

      root.replaceChildren(eyebrow, heading, dataList);
    },
    destroy() {
      root.replaceChildren();
      delete root.dataset.hasSelection;
    }
  };
}

function appendIds(
  list: HTMLDListElement,
  label: string,
  ids: readonly string[]
): void {
  if (ids.length > 0) {
    appendDetail(list, label, ids.join(", "));
  }
}

function appendDetail(
  list: HTMLDListElement,
  term: string,
  description: string
): HTMLElement {
  const termElement = document.createElement("dt");
  termElement.textContent = term;
  const descriptionElement = document.createElement("dd");
  descriptionElement.textContent = description;
  list.append(termElement, descriptionElement);
  return descriptionElement;
}

function appendRelatedRegions(
  list: HTMLDListElement,
  regionIds: string[],
  regionNames?: ReadonlyMap<string, string>
): void {
  const term = document.createElement("dt");
  term.textContent = relatedLabel;
  const description = document.createElement("dd");
  description.className = "related-regions";
  for (const regionId of regionIds) {
    const region = document.createElement("span");
    region.dataset.regionId = regionId;
    region.textContent = regionNames?.get(regionId) ?? getRegionFallback(regionId);
    description.append(region);
  }
  list.append(term, description);
}

function getRegionFallback(regionId: string): string {
  const knownRegions: Record<string, string> = {
    surface: "Surface World",
    "excavation-island": "Excavation Island",
    "mining-hub": "Mining Hub",
    scrapyard: "Scrapyard",
    "underground-station-1": "Underground Station 1",
    "underground-station-2": "Underground Station 2",
    "final-boss-hall": "Final Boss Hall",
    "trashbot-boss": "Trashbot Boss Area",
    "drilling-area-1": "Drilling Area 1",
    "drilling-area-2": "Drilling Area 2",
    "underground-guidance": "Underground Guidance Area"
  };
  const growLab = /^grow-lab-(\d+)$/.exec(regionId);
  if (growLab) {
    return `Grow Lab ${growLab[1]}`;
  }
  return knownRegions[regionId] ?? "Unknown Region";
}
