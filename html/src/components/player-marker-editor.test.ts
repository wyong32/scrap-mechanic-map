import { expect, it, vi } from "vitest";
import type {
  PlayerMarker,
  PlayerMarkerDraft
} from "../player-markers/player-marker";
import { createPlayerMarkerEditor } from "./player-marker-editor";

const draft: PlayerMarkerDraft = {
  mapScopeId: "default",
  regionId: "surface",
  position: { x: 4, y: 6 },
  name: "",
  type: "note",
  notes: ""
};

const marker: PlayerMarker = {
  ...draft,
  id: "marker-1",
  name: "Cotton field",
  type: "resource",
  notes: "Bring crates",
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T08:00:00.000Z"
};

it("submits a trimmed English marker form without losing notes", () => {
  const root = createRoot();
  const onSave = vi.fn();
  const editor = createPlayerMarkerEditor(root, { onSave });
  editor.renderDraft(draft);

  input(root, "Name").value = "  Cotton field  ";
  select(root, "Type").value = "resource";
  textarea(root, "Notes").value = "Bring crates";
  click(root, "Save Marker");

  expect(onSave).toHaveBeenCalledWith({
    ...draft,
    name: "Cotton field",
    type: "resource",
    notes: "Bring crates"
  });
});

it("keeps entered values visible when the controller reports a save error", () => {
  const root = createRoot();
  const editor = createPlayerMarkerEditor(root, {});
  editor.renderDraft(draft);
  input(root, "Name").value = "Cotton";

  editor.setError("Player marker could not be saved.");

  expect(input(root, "Name").value).toBe("Cotton");
  expect(root.querySelector("[role='alert']")?.textContent).toBe(
    "Player marker could not be saved."
  );
});

it("keeps delete confirmation visible while announcing storage errors", () => {
  const root = createRoot();
  const editor = createPlayerMarkerEditor(root, {});
  editor.renderMarker(marker);
  click(root, "Delete");
  const confirmation = root.querySelector<HTMLElement>(
    "[aria-label='Delete Cotton field']"
  );

  editor.setError("Player marker could not be deleted.");

  expect(root.querySelector("[role='alert']")?.textContent).toBe(
    "Player marker could not be deleted."
  );
  expect(confirmation).not.toBeNull();
  expect(root.contains(confirmation)).toBe(true);
  expect(
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Delete Marker"
    )?.disabled
  ).toBe(false);
});

it("validates a required trimmed name and renders coordinates read-only", () => {
  const root = createRoot();
  const onSave = vi.fn();
  const editor = createPlayerMarkerEditor(root, { onSave });
  editor.renderDraft(draft);

  expect(input(root, "Name")).toBe(document.activeElement);
  expect(input(root, "X").readOnly).toBe(true);
  expect(input(root, "X").value).toBe("4");
  expect(input(root, "Y").readOnly).toBe(true);
  expect(input(root, "Y").value).toBe("6");
  expect(
    Array.from(select(root, "Type").options).map((option) => option.textContent)
  ).toEqual(["Resource", "Danger", "Base", "Vehicle", "Note"]);

  input(root, "Name").value = "   ";
  click(root, "Save Marker");

  expect(onSave).not.toHaveBeenCalled();
  expect(root.querySelector("[role='alert']")?.textContent).toBe(
    "Name is required."
  );
  expect(input(root, "Name")).toBe(document.activeElement);
});

it("requires named confirmation before deleting a marker", () => {
  const root = createRoot();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const editor = createPlayerMarkerEditor(root, { onEdit, onDelete });
  editor.renderMarker(marker);

  expect(root.textContent).toContain("Cotton field");
  expect(root.textContent).toContain("Resource");
  expect(root.textContent).toContain("Bring crates");
  click(root, "Edit");
  expect(onEdit).toHaveBeenCalledWith(marker);

  click(root, "Delete");
  expect(onDelete).not.toHaveBeenCalled();
  expect(
    root.querySelector("section[aria-label='Delete Cotton field']")
  ).not.toBeNull();
  click(root, "Keep Marker");
  expect(root.querySelector("[aria-label='Delete Cotton field']")).toBeNull();

  click(root, "Delete");
  click(root, "Delete Marker");
  expect(onDelete).toHaveBeenCalledWith(marker);
});

it("preserves marker identity while editing and supports cancel and cleanup", () => {
  const root = createRoot();
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const editor = createPlayerMarkerEditor(root, { onSave, onCancel });
  editor.renderEdit(marker);

  expect(input(root, "Name").value).toBe("Cotton field");
  expect(input(root, "Name")).toBe(document.activeElement);
  input(root, "Name").value = "Cotton reserve";
  click(root, "Save Changes");
  expect(onSave).toHaveBeenCalledWith({
    ...marker,
    name: "Cotton reserve"
  });

  editor.renderEdit(marker);
  click(root, "Cancel");
  expect(onCancel).toHaveBeenCalledOnce();

  editor.destroy();
  expect(root.children).toHaveLength(0);
  expect(root.hasAttribute("data-has-selection")).toBe(false);
});

function createRoot(): HTMLElement {
  document.body.innerHTML = '<aside data-testid="editor"></aside>';
  return document.querySelector<HTMLElement>("[data-testid='editor']")!;
}

function input(root: HTMLElement, label: string): HTMLInputElement {
  return root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}

function select(root: HTMLElement, label: string): HTMLSelectElement {
  return root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
}

function textarea(root: HTMLElement, label: string): HTMLTextAreaElement {
  return root.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${label}"]`
  )!;
}

function click(root: HTMLElement, name: string): void {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === name
  );
  expect(button, `Button \"${name}\" should exist.`).toBeDefined();
  button!.click();
}
