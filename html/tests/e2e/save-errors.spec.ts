import {
  SYNTHETIC_BINARY_SENTINEL,
  SYNTHETIC_DECODED_SENTINEL,
  SYNTHETIC_PRIVACY_SEED
} from "./fixtures/synthetic-save";
import {
  expect,
  ROTATION_UUIDS,
  SECOND_LAYOUT_UUIDS,
  test
} from "./fixtures/legacy-map-fixture";
import type { Page, Request } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  clearObjectUrlPrivacyArtifacts,
  collectObjectUrlPrivacyArtifacts,
  collectBrowserPrivacyState,
  createConsolePrivacyCapture,
  installObjectUrlPrivacyCapture,
  objectUrlPrivacyCursor
} from "./fixtures/privacy-collector";
import {
  createInt32PrivacySecret,
  createPrivacySecret,
  findPrivacyLeaks,
  type PrivacySecret
} from "./fixtures/privacy-scanner";

const saveInput = "Select a Scrap Mechanic .db save file";

async function expectSaveError(
  page: Page,
  path: string,
  message: string
): Promise<void> {
  await page.getByLabel(saveInput).setInputFiles(path);
  await expect(page.locator("[data-status]")).toContainText(message);
}

test("keeps malformed local saves out of personalized mode", async ({ page, syntheticSaves }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const cases = [
    [await syntheticSaves.createEmpty("synthetic-empty.db"), "empty"],
    [await syntheticSaves.createText("synthetic-text.db"), "not a SQLite"],
    [await syntheticSaves.create({ name: "synthetic-v27.db", version: 27 }), "version is not supported"],
    [await syntheticSaves.create({ name: "synthetic-truncated.db", terrain: "truncated-lua" }), "Read of 16 bits exceeds the available data"],
    [await syntheticSaves.create({ name: "synthetic-unknown.db", terrain: "unknown-uuid" }), "absent from the 1.0 catalog"]
  ] as const;

  for (const [save, message] of cases) {
    await expectSaveError(page, save.path, message);
    await expect(page.locator("[data-mode-badge]")).toHaveText("Base Map");
  }
});

test("keeps a committed personalized map when a replacement fails", async ({ page, syntheticSaves }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const valid = await syntheticSaves.create({ name: "synthetic-committed.db", seed: 616161 });
  const invalid = await syntheticSaves.create({ name: "synthetic-replacement-bad.db", terrain: "unknown-uuid" });
  await page.getByLabel(saveInput).setInputFiles(valid.path);
  await expect(page.locator("[data-status]")).toContainText("Your personal map is ready", {
    timeout: 15_000
  });
  const canvas = page.locator("canvas[data-terrain-frame='committed']");
  const frame = await canvas.evaluate((element) => element.toDataURL());
  const coverage = page.locator("[data-terrain-coverage]");
  const committedCoverage = await coverage.textContent();
  await page.getByLabel(saveInput).setInputFiles(invalid.path);
  await expect(page.locator("[data-status]")).toContainText("absent from the 1.0 catalog");
  await expect(page.locator("[data-mode-file]")).toHaveText(valid.name);
  await expect(page.locator("[data-mode-meta]")).toHaveText("Seed 616161 · Save Version 28");
  await expect(coverage).toHaveText(committedCoverage ?? "");
  await expect.poll(() => canvas.evaluate((element) => element.toDataURL())).toBe(frame);
  await expect(page.getByRole("button", { name: "Zoom Out" })).toBeEnabled();
  await page.getByRole("button", { name: "Zoom Out" }).click();
});

test("rejects an over-limit save from metadata without entering personalized mode", async ({
  page,
  syntheticSaves
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const oversized = await syntheticSaves.createOversized("synthetic-oversized.db");
  await expectSaveError(page, oversized.path, "exceeds the 256 MB limit");
  await expect(page.locator("[data-mode-badge]")).toHaveText("Base Map");
});

test("does not persist or transmit synthetic save metadata", async ({ page, syntheticSaves }) => {
  const requests: unknown[] = [];
  const consoleCapture = createConsolePrivacyCapture(page);
  const onRequest = (request: Request): void => {
    try {
      requests.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        text: request.postData() ?? "",
        body: request.postDataBuffer() ?? Buffer.alloc(0)
      });
    } catch {
      requests.push({ inspectionError: "request.body" });
    }
  };
  page.on("request", onRequest);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const save = await syntheticSaves.create({
    name: "synthetic-private-check.db",
    seed: SYNTHETIC_PRIVACY_SEED
  });
  await page.getByLabel(saveInput).setInputFiles(save.path);
  await expect(page.locator("[data-status]")).toContainText("Your personal map is ready");
  const browserState = await page.evaluate(collectBrowserPrivacyState, undefined);
  const consoleMessages = await consoleCapture.finish();
  page.off("request", onRequest);
  expect(browserState.databases).toEqual([]);
  expect(browserState.caches).toEqual([]);
  const secrets: PrivacySecret[] = [
    createPrivacySecret(
      "synthetic save",
      SYNTHETIC_BINARY_SENTINEL,
      [save.name, "SQLite format 3"]
    ),
    createInt32PrivacySecret("seed", save.seed),
    createInt32PrivacySecret("decoded sentinel", SYNTHETIC_DECODED_SENTINEL)
  ];
  expect(findPrivacyLeaks({ requests, consoleMessages, browserState }, secrets)).toEqual([]);
});

test("loads only each layout's legacy assets on demand and leaves no private trace", async ({
  page,
  legacyMapSaves
}) => {
  await installObjectUrlPrivacyCapture(page);
  const requestsBySelection: unknown[][] = [[], []];
  const preSelectionLegacyRequests: string[] = [];
  const postSelectionLegacyRequests: string[][] = [[], []];
  let activeSelection: 0 | 1 | undefined;
  const onRequest = (request: Request): void => {
    let pathname = "";
    let observation: unknown;
    try {
      pathname = new URL(request.url()).pathname;
      observation = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        text: request.postData() ?? "",
        body: request.postDataBuffer() ?? Buffer.alloc(0)
      };
    } catch {
      observation = { inspectionError: "request.body" };
    }
    if (activeSelection !== undefined) {
      requestsBySelection[activeSelection].push(observation);
    }
    if (!pathname.startsWith("/legacy/")) return;
    if (activeSelection === undefined) {
      preSelectionLegacyRequests.push(pathname);
    } else {
      postSelectionLegacyRequests[activeSelection].push(pathname);
    }
  };
  page.on("request", onRequest);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel(saveInput)).toBeVisible();
  expect(preSelectionLegacyRequests).toEqual([]);
  await clearObjectUrlPrivacyArtifacts(page);
  const transientValue = "alpha-layout-temporary-private-state";
  const transientSecret = createPrivacySecret(
    "temporary alpha state",
    new TextEncoder().encode(transientValue),
    [transientValue]
  );
  await page.evaluate((value) => {
    localStorage.setItem("temporary-layout-state", value);
  }, transientValue);
  const alphaTemporarySnapshot = await page.evaluate(
    collectBrowserPrivacyState,
    undefined
  );
  await page.evaluate(() => {
    localStorage.removeItem("temporary-layout-state");
  });
  const afterAlphaRemoval = await page.evaluate(
    collectBrowserPrivacyState,
    undefined
  );
  expect(findPrivacyLeaks(alphaTemporarySnapshot, [transientSecret])).toEqual([
    "temporary alpha state"
  ]);
  expect(findPrivacyLeaks(afterAlphaRemoval, [transientSecret])).toEqual([]);

  const blobHarnessCursor = await objectUrlPrivacyCursor(page);
  await page.evaluate((bytes) => {
    URL.createObjectURL(new Blob([Uint8Array.from(bytes)]));
  }, [...SYNTHETIC_BINARY_SENTINEL]);
  const blobHarnessArtifacts = await collectObjectUrlPrivacyArtifacts(
    page,
    blobHarnessCursor
  );
  expect(blobHarnessArtifacts).toEqual([
    {
      url: expect.stringMatching(/^blob:/),
      bytes: [...SYNTHETIC_BINARY_SENTINEL]
    }
  ]);
  expect(
    findPrivacyLeaks(blobHarnessArtifacts, [
      createPrivacySecret(
        "generated Blob sentinel",
        SYNTHETIC_BINARY_SENTINEL,
        []
      )
    ])
  ).toEqual(["generated Blob sentinel"]);
  await page.evaluate(
    (url) => URL.revokeObjectURL(url),
    blobHarnessArtifacts[0]!.url
  );
  await clearObjectUrlPrivacyArtifacts(page);

  const saves = [
    await legacyMapSaves.createPrivacyLayout(
      "private-layout-alpha.db",
      0,
      717171
    ),
    await legacyMapSaves.createPrivacyLayout(
      "private-layout-omega.db",
      1,
      818181
    )
  ] as const;
  const uuidBytes = (uuid: string) =>
    Uint8Array.from(
      (uuid.match(/[0-9a-f]{2}/gi) ?? [])
        .map((part) => Number.parseInt(part, 16))
        .reverse()
    );
  const completeSaveSecrets = await Promise.all(
    saves.map(
      async (save) =>
        ({
          name: `complete save ${save.name}`,
          bytes: new Uint8Array(await readFile(save.path)),
          forms: []
        }) satisfies PrivacySecret
    )
  );
  const secrets: PrivacySecret[] = [
    ...saves.map(
      (save) =>
        ({
          name: `save bytes ${save.name}`,
          bytes: new Uint8Array(),
          forms: [save.name]
        }) satisfies PrivacySecret
    ),
    ...completeSaveSecrets,
    createPrivacySecret(
      "synthetic save sentinel",
      SYNTHETIC_BINARY_SENTINEL,
      ["SQLite format 3"]
    ),
    createInt32PrivacySecret("layout alpha seed", saves[0].seed),
    createInt32PrivacySecret("layout omega seed", saves[1].seed),
    createInt32PrivacySecret("decoded sentinel", SYNTHETIC_DECODED_SENTINEL),
    ...[...ROTATION_UUIDS, ...SECOND_LAYOUT_UUIDS].map((uuid) =>
      createPrivacySecret(`layout UUID ${uuid}`, uuidBytes(uuid), [uuid])
    )
  ];

  for (const selection of [0, 1] as const) {
    const consoleCapture = createConsolePrivacyCapture(page);
    const objectUrlCursor = await objectUrlPrivacyCursor(page);
    activeSelection = selection;
    await page.getByLabel(saveInput).setInputFiles(saves[selection].path);
    await expect(page.locator("[data-status]")).toContainText(
      "Your personal map is ready",
      { timeout: 15_000 }
    );
    await expect(page.locator("[data-mode-file]")).toHaveText(saves[selection].name);
    await page.waitForLoadState("networkidle");
    const [browserState, objectUrls, consoleMessages] = await Promise.all([
      page.evaluate(collectBrowserPrivacyState, undefined),
      collectObjectUrlPrivacyArtifacts(page, objectUrlCursor),
      consoleCapture.finish()
    ]);
    expect(browserState.databases).toEqual([]);
    expect(browserState.caches).toEqual([]);
    const observation = {
      requests: requestsBySelection[selection],
      consoleMessages,
      browserState,
      artifacts: {
        frame: await page
          .locator("canvas[data-terrain-frame='committed']")
          .evaluate((canvas) => canvas.toDataURL()),
        objectUrls
      }
    };
    expect(
      findPrivacyLeaks(observation, secrets),
      `layout ${selection} privacy findings`
    ).toEqual([]);
    await clearObjectUrlPrivacyArtifacts(page);
  }

  activeSelection = undefined;
  page.off("request", onRequest);

  expect(postSelectionLegacyRequests).toEqual([
    [
      "/legacy/img/tiles/10105.jpg",
      "/legacy/img/tiles/10106.jpg",
      "/legacy/img/tiles/10107.jpg",
      "/legacy/img/tiles/10108.jpg"
    ],
    [
      "/legacy/img/tiles/11501.jpg",
      "/legacy/img/tiles/11502.jpg",
      "/legacy/img/tiles/11503.jpg",
      "/legacy/img/tiles/11504.jpg"
    ]
  ]);
});
