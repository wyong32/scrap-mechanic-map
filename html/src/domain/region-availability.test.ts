import { describe, expect, it } from "vitest";
import { isRegionAvailable } from "./region-availability";

describe("isRegionAvailable", () => {
  it("allows only Surface World", () => {
    expect(isRegionAvailable("surface")).toBe(true);
    expect(isRegionAvailable("scrapyard")).toBe(false);
    expect(isRegionAvailable("grow-lab-1")).toBe(false);
    expect(isRegionAvailable("drilling-area-1")).toBe(false);
  });

  it("fails closed for unknown and empty region IDs", () => {
    expect(isRegionAvailable("future-region")).toBe(false);
    expect(isRegionAvailable("")).toBe(false);
  });
});
