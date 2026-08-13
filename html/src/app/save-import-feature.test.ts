import { describe, expect, it, vi } from "vitest";

const { saveClientConstructor } = vi.hoisted(() => ({
  saveClientConstructor: vi.fn()
}));

vi.mock("../save/save-client", () => ({
  SaveClient: saveClientConstructor
}));

import {
  createSaveParser,
  isSaveImportEnabled
} from "./save-import-feature";

describe("isSaveImportEnabled", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["TRUE", false],
    ["1", false],
    [true, false],
    [false, false],
    ["true", true]
  ])("enables only the exact true string for %j", (value, enabled) => {
    expect(isSaveImportEnabled(value)).toBe(enabled);
  });
});

describe("createSaveParser", () => {
  it("does not construct the parser until the factory is invoked", async () => {
    expect(saveClientConstructor).not.toHaveBeenCalled();

    await createSaveParser();

    expect(saveClientConstructor).toHaveBeenCalledTimes(1);
  });
});
