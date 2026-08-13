import { describe, expect, it } from "vitest";
import { compareCanonicalStrings } from "./canonical-order";

describe("compareCanonicalStrings", () => {
  it("orders Unicode scalar values rather than host locale or UTF-16 units", () => {
    const privateUseBmp = "\uE000";
    const firstSupplementaryCodePoint = "\u{10000}";

    expect(
      [firstSupplementaryCodePoint, privateUseBmp]
        .sort(compareCanonicalStrings)
    ).toEqual([privateUseBmp, firstSupplementaryCodePoint]);
    expect(["prefix-b", "prefix", "prefix-a"].sort(compareCanonicalStrings))
      .toEqual(["prefix", "prefix-a", "prefix-b"]);
  });
});
