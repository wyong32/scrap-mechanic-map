import { expect, it } from "vitest";
import { SaveParseError } from "../save/save-errors";
import { renderStartupError } from "./startup-error";

it("replaces a partial shell with an accessible recoverable Canvas error", () => {
  const root = document.createElement("main");
  root.innerHTML = "<button>stale control</button>";

  renderStartupError(
    root,
    new SaveParseError("UNSUPPORTED_BROWSER", {
      message: "Canvas 2D is unavailable."
    })
  );

  expect(root.querySelector("button")).toBeNull();
  expect(root.dataset.startupStatus).toBe("error");
  expect(root.querySelector("[role='alert']")?.textContent).toContain(
    "Canvas 2D is unavailable."
  );
  expect(root.textContent).toContain("Canvas 2D");
});
