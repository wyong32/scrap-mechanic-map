import { expect, it } from "vitest";
import {
  createTerrainCoverage,
  type TerrainCoverageSummary
} from "./terrain-coverage";

it("explains that a Survival v28 save is required for the real terrain layout", () => {
  document.body.innerHTML = '<section data-terrain-coverage></section>';

  createTerrainCoverage(
    document.querySelector<HTMLElement>("[data-terrain-coverage]")!
  );

  expect(document.body.textContent).toContain(
    "Select a Scrap Mechanic 1.0 Survival save to build the map from its actual terrain layout."
  );
});

it("reports aggregate legacy, official 1.0, and missing-image coverage", () => {
  document.body.innerHTML = '<section data-terrain-coverage></section>';
  const coverage = createTerrainCoverage(
    document.querySelector<HTMLElement>("[data-terrain-coverage]")!
  );
  const summary: TerrainCoverageSummary = {
    totalCells: 7_123,
    legacyImageCells: 4_321,
    oneDotZeroImageCells: 0,
    fallbackCells: 2_802,
    distinctFallbackUuids: 442
  };

  coverage.setSummary(summary);

  const text = document.body.textContent ?? "";
  expect(text).toContain("Legacy images 4,321 cells");
  expect(text).toContain("Official 1.0 images 0 cells");
  expect(text).toContain("Missing images 2,802 cells");
  expect(text).toContain("Terrain Coverage · 7,123 cells");
  expect(text).toContain("442 terrain types");
  expect(text).not.toMatch(/\.db|seed|uuid|[a-z]:\\|\/users\//i);
});

it("clears personal aggregate coverage when returning to the base map", () => {
  document.body.innerHTML = '<section data-terrain-coverage></section>';
  const coverage = createTerrainCoverage(
    document.querySelector<HTMLElement>("[data-terrain-coverage]")!
  );

  coverage.setSummary({
    totalCells: 10,
    legacyImageCells: 6,
    oneDotZeroImageCells: 0,
    fallbackCells: 4,
    distinctFallbackUuids: 2
  });
  coverage.setSummary(undefined);

  expect(document.body.textContent).toContain(
    "Select a Scrap Mechanic 1.0 Survival save to build the map from its actual terrain layout."
  );
  expect(document.body.textContent).not.toContain("Legacy images 6 cells");
});
