import {
  PLAYER_MARKER_TYPES,
  type PlayerMarker,
  type PlayerMarkerDraft,
  type PlayerMarkerType
} from "../player-markers/player-marker";

const typeLabels: Record<PlayerMarkerType, string> = {
  resource: "Resource",
  danger: "Danger",
  base: "Base",
  vehicle: "Vehicle",
  note: "Note"
};

export interface PlayerMarkerEditorCallbacks {
  onSave?(value: PlayerMarkerDraft | PlayerMarker): void;
  onCancel?(): void;
  onEdit?(marker: PlayerMarker): void;
  onDelete?(marker: PlayerMarker): void;
}

export interface PlayerMarkerEditor {
  renderEmpty(): void;
  renderDraft(draft: PlayerMarkerDraft): void;
  renderMarker(marker: PlayerMarker): void;
  renderEdit(marker: PlayerMarker): void;
  setError(message: string): void;
  destroy(): void;
}

export function createPlayerMarkerEditor(
  root: HTMLElement,
  callbacks: PlayerMarkerEditorCallbacks
): PlayerMarkerEditor {
  const renderForm = (
    value: PlayerMarkerDraft | PlayerMarker,
    mode: "create" | "edit"
  ) => {
    root.dataset.hasSelection = "true";
    root.dataset.markerEditorMode = mode;

    const eyebrow = document.createElement("p");
    eyebrow.className = "detail-panel__eyebrow";
    eyebrow.textContent = mode === "create" ? "New Player Marker" : "Edit Player Marker";

    const heading = document.createElement("h2");
    heading.textContent = mode === "create" ? "Add Marker" : value.name;

    const form = document.createElement("form");
    form.className = "player-marker-editor__form";
    form.noValidate = true;

    const name = document.createElement("input");
    name.type = "text";
    name.value = value.name;
    name.autocomplete = "off";
    name.required = true;
    form.append(createField("Name", name));

    const type = document.createElement("select");
    for (const markerType of PLAYER_MARKER_TYPES) {
      const option = document.createElement("option");
      option.value = markerType;
      option.textContent = typeLabels[markerType];
      type.append(option);
    }
    type.value = value.type;
    form.append(createField("Type", type));

    const notes = document.createElement("textarea");
    notes.rows = 4;
    notes.value = value.notes;
    form.append(createField("Notes", notes));

    const coordinates = document.createElement("div");
    coordinates.className = "player-marker-editor__coordinates";
    coordinates.append(
      createCoordinateField("X", value.position.x),
      createCoordinateField("Y", value.position.y)
    );
    form.append(coordinates);

    const error = createErrorOutput();
    form.append(error);

    const actions = document.createElement("div");
    actions.className = "player-marker-editor__actions";
    const save = createButton(mode === "create" ? "Save Marker" : "Save Changes", "submit");
    const cancel = createButton("Cancel");
    cancel.addEventListener("click", () => callbacks.onCancel?.());
    actions.append(save, cancel);
    form.append(actions);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const normalizedName = name.value.trim();
      if (normalizedName.length === 0) {
        setError("Name is required.");
        name.focus({ preventScroll: true });
        return;
      }
      setError("");
      const changes = {
        name: normalizedName,
        type: type.value as PlayerMarkerType,
        notes: notes.value
      };
      callbacks.onSave?.(
        mode === "edit"
          ? { ...(value as PlayerMarker), ...changes }
          : { ...value, ...changes }
      );
    });

    root.replaceChildren(eyebrow, heading, form);
    name.focus({ preventScroll: true });
  };

  const setError = (message: string) => {
    const error = root.querySelector<HTMLElement>("[data-player-marker-error]");
    if (!error) {
      return;
    }
    error.textContent = message;
    error.hidden = message.length === 0;
  };

  return {
    renderEmpty() {
      root.dataset.hasSelection = "false";
      delete root.dataset.markerEditorMode;
      const heading = document.createElement("h2");
      heading.textContent = "Player Markers";
      const empty = document.createElement("p");
      empty.className = "detail-panel__empty";
      empty.textContent = "Select a player marker or choose Add Marker.";
      root.replaceChildren(heading, empty);
    },
    renderDraft(value) {
      renderForm(value, "create");
    },
    renderMarker(value) {
      root.dataset.hasSelection = "true";
      root.dataset.markerEditorMode = "view";

      const eyebrow = document.createElement("p");
      eyebrow.className = "detail-panel__eyebrow";
      eyebrow.textContent = "Player Marker";
      const heading = document.createElement("h2");
      heading.textContent = value.name;
      const details = document.createElement("dl");
      details.className = "detail-list player-marker-editor__details";
      appendDetail(details, "Type", typeLabels[value.type]);
      if (value.notes.length > 0) {
        appendDetail(details, "Notes", value.notes);
      }
      appendDetail(details, "Coordinates", `X ${value.position.x}, Y ${value.position.y}`);

      const actions = document.createElement("div");
      actions.className = "player-marker-editor__actions";
      const error = createErrorOutput();
      const edit = createButton("Edit");
      const remove = createButton("Delete");
      remove.classList.add("player-marker-editor__delete-trigger");
      edit.addEventListener("click", () => callbacks.onEdit?.(value));
      remove.addEventListener("click", () => {
        const confirmation = createDeleteConfirmation(value, callbacks, () => {
          confirmation.remove();
          remove.focus({ preventScroll: true });
        });
        root.querySelector(".player-marker-editor__delete-confirmation")?.remove();
        root.append(confirmation);
        confirmation.querySelector<HTMLButtonElement>("button")?.focus({
          preventScroll: true
        });
      });
      actions.append(edit, remove);
      root.replaceChildren(eyebrow, heading, details, error, actions);
    },
    renderEdit(value) {
      renderForm(value, "edit");
    },
    setError,
    destroy() {
      root.replaceChildren();
      delete root.dataset.hasSelection;
      delete root.dataset.markerEditorMode;
    }
  };
}

function createField(
  text: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "player-marker-editor__field";
  const caption = document.createElement("span");
  caption.textContent = text;
  control.setAttribute("aria-label", text);
  label.append(caption, control);
  return label;
}

function createCoordinateField(text: string, value: number): HTMLLabelElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = String(value);
  input.readOnly = true;
  return createField(text, input);
}

function createButton(text: string, type: "button" | "submit" = "button"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = type;
  button.textContent = text;
  return button;
}

function createErrorOutput(): HTMLParagraphElement {
  const error = document.createElement("p");
  error.className = "player-marker-editor__error";
  error.dataset.playerMarkerError = "";
  error.setAttribute("role", "alert");
  error.hidden = true;
  return error;
}

function appendDetail(list: HTMLDListElement, term: string, value: string): void {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  list.append(dt, dd);
}

function createDeleteConfirmation(
  marker: PlayerMarker,
  callbacks: PlayerMarkerEditorCallbacks,
  keepMarker: () => void
): HTMLElement {
  const confirmation = document.createElement("section");
  confirmation.className = "player-marker-editor__delete-confirmation";
  confirmation.setAttribute("aria-label", `Delete ${marker.name}`);
  const heading = document.createElement("h3");
  heading.textContent = `Delete ${marker.name}?`;
  const message = document.createElement("p");
  message.textContent = "This marker will be removed from this browser.";
  const actions = document.createElement("div");
  actions.className = "player-marker-editor__actions";
  const confirm = createButton("Delete Marker");
  const keep = createButton("Keep Marker");
  confirm.addEventListener("click", () => callbacks.onDelete?.(marker));
  keep.addEventListener("click", keepMarker);
  actions.append(confirm, keep);
  confirmation.append(heading, message, actions);
  return confirmation;
}
