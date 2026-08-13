import { expect, it, vi } from "vitest";
import { createSaveEntry } from "./save-entry";

it("shows the default Windows Survival save directory below the drop zone", () => {
  const root = document.createElement("section");
  createSaveEntry(root);

  const hint = root.querySelector<HTMLElement>("[data-save-path-hint]")!;
  expect(hint.textContent).toContain("Find your Survival save here");
  expect(hint.textContent).toContain(
    "%APPDATA%\\Axolot Games\\Scrap Mechanic\\User\\User_<SteamID>\\Save\\Survival"
  );
  expect(hint.textContent).toContain("Select a .db file");
});

it("clears the native input after capturing a selected database for same-file retry", () => {
  const root = document.createElement("section");
  const onSaveSelect = vi.fn();
  const entry = createSaveEntry(root, onSaveSelect);
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["SQLite format 3\0"], "same.db");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file]
  });
  Object.defineProperty(input, "value", {
    configurable: true,
    writable: true,
    value: "C:\\fakepath\\same.db"
  });

  input.dispatchEvent(new Event("change", { bubbles: true }));

  expect(onSaveSelect).toHaveBeenCalledWith(file);
  expect(input.value).toBe("");
  entry.destroy();
});
