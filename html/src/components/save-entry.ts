import {
  createTerrainCoverage,
  type TerrainCoverage,
  type TerrainCoverageSummary
} from "./terrain-coverage";

const selectSave = "Select Save";
const dropSave = "or drop a .db save file here";
const saveInputLabel = "Select a Scrap Mechanic .db save file";
const replaceSave = "Replace Save";
const privacyCopy =
  "Your save is processed only in this browser's memory. It is never uploaded or stored.";
const defaultSavePath =
  "%APPDATA%\\Axolot Games\\Scrap Mechanic\\User\\User_&lt;SteamID&gt;\\Save\\Survival";

export interface SaveEntry {
  setPersonalized(personalized: boolean): void;
  setTerrainCoverage(summary?: TerrainCoverageSummary): void;
  destroy(): void;
}

export function createSaveEntry(
  root: HTMLElement,
  onSaveSelect?: (file: File) => void
): SaveEntry {
  const inputId = "save-file-input";
  root.innerHTML = `
    <button class="save-entry__button" type="button">${selectSave}</button>
    <input class="visually-hidden" id="${inputId}" type="file" accept=".db"
      aria-label="${saveInputLabel}" />
    <div class="save-entry__drop-zone" data-save-drop-zone>
      <span>${dropSave}</span>
    </div>
    <aside class="save-entry__path-hint" data-save-path-hint>
      <strong>Find your Survival save here:</strong>
      <code>${defaultSavePath}</code>
      <span>Paste this path into the Windows File Explorer address bar. Select a .db file.</span>
    </aside>
    <p class="save-entry__privacy" data-save-privacy>${privacyCopy}</p>
    <section class="terrain-coverage" data-terrain-coverage
      aria-live="polite" aria-atomic="true"></section>
  `;

  const button = root.querySelector<HTMLButtonElement>("button")!;
  const input = root.querySelector<HTMLInputElement>("input")!;
  const dropZone = root.querySelector<HTMLElement>("[data-save-drop-zone]")!;
  const terrainCoverage: TerrainCoverage = createTerrainCoverage(
    root.querySelector<HTMLElement>("[data-terrain-coverage]")!
  );

  const emitIfDatabase = (file?: File) => {
    if (file?.name.toLocaleLowerCase().endsWith(".db")) {
      onSaveSelect?.(file);
    }
  };
  const handleButtonClick = () => input.click();
  const handleInputChange = () => {
    const selectedFile = input.files?.[0];
    input.value = "";
    emitIfDatabase(selectedFile);
  };
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    dropZone.dataset.dragActive = "true";
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  };
  const handleDragLeave = () => delete dropZone.dataset.dragActive;
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    delete dropZone.dataset.dragActive;
    emitIfDatabase(event.dataTransfer?.files[0]);
  };

  button.addEventListener("click", handleButtonClick);
  input.addEventListener("change", handleInputChange);
  dropZone.addEventListener("dragover", handleDragOver);
  dropZone.addEventListener("dragleave", handleDragLeave);
  dropZone.addEventListener("drop", handleDrop);

  return {
    setPersonalized(personalized) {
      button.textContent = personalized ? replaceSave : selectSave;
    },
    setTerrainCoverage(summary) {
      terrainCoverage.setSummary(summary);
    },
    destroy() {
      button.removeEventListener("click", handleButtonClick);
      input.removeEventListener("change", handleInputChange);
      dropZone.removeEventListener("dragover", handleDragOver);
      dropZone.removeEventListener("dragleave", handleDragLeave);
      dropZone.removeEventListener("drop", handleDrop);
      terrainCoverage.destroy();
      root.replaceChildren();
    }
  };
}
