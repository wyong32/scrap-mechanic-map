export function renderStartupError(
  root: HTMLElement,
  error: unknown
): void {
  const detail =
    error instanceof Error
      ? error.message
      : "The map could not start.";
  const alert = document.createElement("p");
  alert.className = "status-readout";
  alert.dataset.status = "";
  alert.setAttribute("role", "alert");
  alert.textContent =
    `${detail} Please try again in a browser that supports Canvas 2D.`;
  root.dataset.startupStatus = "error";
  root.replaceChildren(alert);
}
