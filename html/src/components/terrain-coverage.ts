export interface TerrainCoverageSummary {
  totalCells: number;
  legacyImageCells: number;
  oneDotZeroImageCells: number;
  fallbackCells: number;
  distinctFallbackUuids: number;
}

export interface TerrainCoverage {
  setSummary(summary?: TerrainCoverageSummary): void;
  destroy(): void;
}

const savePrompt =
  "Select a Scrap Mechanic 1.0 Survival save to build the map from its actual terrain layout.";
const number = new Intl.NumberFormat("en-US");

function summaryMarkup(summary: TerrainCoverageSummary): string {
  return `
    <p class="terrain-coverage__heading">
      Terrain Coverage · ${number.format(summary.totalCells)} cells
    </p>
    <ul class="terrain-coverage__items">
      <li><span>Legacy images </span><strong>${number.format(summary.legacyImageCells)} cells</strong></li>
      <li><span>Official 1.0 images </span><strong>${number.format(summary.oneDotZeroImageCells)} cells</strong></li>
      <li><span>Missing images </span><strong>${number.format(summary.fallbackCells)} cells</strong></li>
    </ul>
    <p class="terrain-coverage__note">
      ${summary.fallbackCells === 0
        ? "Every terrain cell has a real image; the layout comes from the current save."
        : `Missing images affect ${number.format(summary.distinctFallbackUuids)} terrain types; the layout comes from the current save.`}
    </p>
  `;
}

export function createTerrainCoverage(root: HTMLElement): TerrainCoverage {
  const setSummary = (summary?: TerrainCoverageSummary) => {
    root.dataset.personal = String(Boolean(summary));
    root.innerHTML = summary
      ? summaryMarkup(summary)
      : `<p class="terrain-coverage__prompt">${savePrompt}</p>`;
  };

  setSummary();

  return {
    setSummary,
    destroy() {
      root.replaceChildren();
    }
  };
}
