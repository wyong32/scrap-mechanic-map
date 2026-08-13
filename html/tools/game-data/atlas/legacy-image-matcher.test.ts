import { expect, it } from "vitest";
import { legacyImageMappings, matchLegacyImage } from "./legacy-image-matcher.ts";
it("never infers a mapping from legacy numeric filenames", () => { expect(legacyImageMappings).toEqual({}); expect(matchLegacyImage("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "C:/legacy/1000001.jpg")).toBeUndefined(); });
