import { afterEach, expect, it, vi } from "vitest";
import { loadBundledSave } from "./default-save";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("downloads the bundled database as a named File", async () => {
  const bytes = new Uint8Array([83, 81, 76, 105, 116, 101]);
  const fetchMock = vi.fn(async () => new Response(bytes));
  vi.stubGlobal("fetch", fetchMock);

  const file = await loadBundledSave("/data/default-save.db", "bilige.db");

  expect(fetchMock).toHaveBeenCalledWith("/data/default-save.db");
  expect(file.name).toBe("bilige.db");
  expect(file.type).toBe("application/vnd.sqlite3");
  expect(file.size).toBe(bytes.byteLength);
});
