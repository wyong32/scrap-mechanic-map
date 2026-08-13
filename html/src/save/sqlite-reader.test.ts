import { describe, expect, it } from "vitest";
import { SaveParseError } from "./save-errors";
import { createSaveFixture } from "./fixtures/create-save-fixture";
import { readSaveRecords } from "./sqlite-reader";

function expectCode(code: SaveParseError["code"]): {
  code: SaveParseError["code"];
} {
  return { code };
}

describe("readSaveRecords", () => {
  it("initializes browser SQL and returns shared records for world 1 blobs", async () => {
    const bytes = await createSaveFixture();
    const records = await readSaveRecords(bytes);

    expect(records).toEqual({
      saveVersion: 28,
      seed: 360160198,
      surfaceCandidates: [new Uint8Array([1, 2, 3, 4]), new Uint8Array([9, 8])]
    });
    expect(records.surfaceCandidates[0]?.buffer).not.toBe(bytes.buffer);
  });

  it("retains only the eight longest candidates from a larger candidate set", async () => {
    const scriptRows = Array.from({ length: 12 }, (_, index) => ({
      worldId: 1,
      data: new Uint8Array(index + 1)
    }));

    const records = await readSaveRecords(await createSaveFixture({ scriptRows }));

    expect(records.surfaceCandidates.map((candidate) => candidate.byteLength)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5
    ]);
  });

  it("bounds a 200,000-row metadata scan to eight retained blobs", async () => {
    const bytes = await createSaveFixture({
      repeatedScriptRow: {
        count: 200_000,
        worldId: 1,
        data: new Uint8Array([1])
      }
    });

    const records = await readSaveRecords(bytes);

    expect(records.surfaceCandidates.length).toBe(8);
    expect(records.surfaceCandidates.every((candidate) => candidate.byteLength === 1)).toBe(true);
  }, 60_000);

  it("accepts the cumulative compressed-byte budget and rejects one byte above it", async () => {
    const candidateBytes = 1536 * 1024;
    const atBudget = Array.from({ length: 8 }, () => ({
      worldId: 1,
      data: new Uint8Array(candidateBytes)
    }));
    const overBudget = atBudget.map((row, index) => ({
      ...row,
      data: new Uint8Array(candidateBytes + (index === 0 ? 1 : 0))
    }));

    const accepted = await readSaveRecords(
      await createSaveFixture({ scriptRows: atBudget })
    );
    expect(accepted.surfaceCandidates.map((candidate) => candidate.byteLength)).toEqual(
      Array.from({ length: 8 }, () => candidateBytes)
    );
    let overBudgetError: unknown;
    try {
      await readSaveRecords(await createSaveFixture({ scriptRows: overBudget }));
    } catch (error) {
      overBudgetError = error;
    }
    expect(overBudgetError).toMatchObject(expectCode("NOT_SURVIVAL_SAVE"));
  }, 60_000);

  it.each([
    [{ createGameTable: false }, "missing Game"],
    [{ createScriptDataTable: false }, "missing ScriptData"]
  ] as const)("rejects a save with %s", async (options, _label) => {
    await expect(readSaveRecords(await createSaveFixture(options))).rejects.toMatchObject(
      expectCode("NOT_SURVIVAL_SAVE")
    );
  });

  it.each([
    [[], "zero"],
    [
      [
        { saveVersion: 28, seed: 1 },
        { saveVersion: 28, seed: 2 }
      ],
      "multiple"
    ]
  ] as const)("rejects %s Game rows", async (gameRows, _label) => {
    await expect(readSaveRecords(await createSaveFixture({ gameRows: [...gameRows] }))).rejects.toMatchObject(
      expectCode("NOT_SURVIVAL_SAVE")
    );
  });

  it.each([
    [{ saveVersion: "not-an-integer", seed: 360160198 }, "text version"],
    [{ saveVersion: 28, seed: "not-an-integer" }, "text seed"],
    [{ saveVersion: 28.5, seed: 360160198 }, "fractional version"],
    [{ saveVersion: 28, seed: 360160198.5 }, "fractional seed"]
  ])("rejects malformed Game values: %s", async (gameRow, _label) => {
    await expect(readSaveRecords(await createSaveFixture({ gameRows: [gameRow] }))).rejects.toMatchObject(
      expectCode("NOT_SURVIVAL_SAVE")
    );
  });

  it("rejects unsupported save versions distinctly", async () => {
    const bytes = await createSaveFixture({
      gameRows: [{ saveVersion: 27, seed: 360160198 }]
    });

    await expect(readSaveRecords(bytes)).rejects.toMatchObject(expectCode("UNSUPPORTED_SAVE_VERSION"));
  });

  it("rejects malformed world 1 blob values", async () => {
    const bytes = await createSaveFixture({
      scriptRows: [{ worldId: 1, data: "not a blob" }]
    });

    await expect(readSaveRecords(bytes)).rejects.toMatchObject(expectCode("NOT_SURVIVAL_SAVE"));
  });

  it.each([
    { name: "no ScriptData rows", scriptRows: [] },
    {
      name: "only unrelated world rows",
      scriptRows: [{ worldId: 65534, data: new Uint8Array([1]) }]
    },
    {
      name: "only empty world 1 blobs",
      scriptRows: [{ worldId: 1, data: new Uint8Array() }]
    }
  ])("rejects missing surface data: $name", async ({ scriptRows }) => {
    await expect(readSaveRecords(await createSaveFixture({ scriptRows }))).rejects.toMatchObject(
      expectCode("MISSING_SURFACE_DATA")
    );
  });

  it("maps malformed SQLite bytes to NOT_SURVIVAL_SAVE", async () => {
    await expect(readSaveRecords(new Uint8Array([1, 2, 3]))).rejects.toMatchObject(
      expectCode("NOT_SURVIVAL_SAVE")
    );
  });
});
