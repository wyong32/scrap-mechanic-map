import { expect, test } from "./fixtures/legacy-map-fixture";
import type { Page, Request, Response } from "@playwright/test";

const appOrigin = "http://127.0.0.1:4175";
const saveInput = "Select a Scrap Mechanic .db save file";
const mapReadyTimeout = 30_000;
const networkQuietWindow = 500;
const networkStableTimeout = 15_000;
const optionalPath = (pathname: string): boolean =>
  pathname.startsWith("/legacy/img/") || pathname.startsWith("/atlas/official/");

interface NetworkRequest {
  url: string;
  pathname: string;
  resourceType: string;
}

interface NetworkResponse {
  url: string;
  pathname: string;
  resourceType: string;
  status: number;
  bytes?: number;
  byteSource?: "body" | "content-length";
  accountingError?: string;
}

interface NetworkFailure extends NetworkRequest {
  errorText: string;
}

interface NetworkSnapshot {
  requests: NetworkRequest[];
  responses: NetworkResponse[];
  failures: NetworkFailure[];
}

interface TrackedRequest extends NetworkRequest {
  request: Request;
  settled: boolean;
  response?: Promise<NetworkResponse>;
  failure?: NetworkFailure;
}

function recordNetwork(page: Page): {
  cursor: () => number;
  settleFrom: (
    from: number,
    options?: { requireBodyAccounting?: boolean }
  ) => Promise<NetworkSnapshot>;
  stop: () => void;
} {
  const requests: TrackedRequest[] = [];
  const byRequest = new Map<Request, TrackedRequest>();
  const activityWaiters = new Set<() => void>();
  const sameOrigin = (url: string): boolean => new URL(url).origin === appOrigin;
  const signalActivity = (): void => {
    for (const wake of [...activityWaiters]) wake();
  };
  const waitForActivity = (timeout: number): Promise<boolean> =>
    new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        activityWaiters.delete(wake);
        resolve(true);
      };
      const timer = setTimeout(() => {
        activityWaiters.delete(wake);
        resolve(false);
      }, timeout);
      activityWaiters.add(wake);
    });
  const onRequest = (request: Request): void => {
    if (!sameOrigin(request.url())) return;
    const url = new URL(request.url());
    const record: TrackedRequest = {
      request,
      url: url.href,
      pathname: url.pathname,
      resourceType: request.resourceType(),
      settled: false
    };
    requests.push(record);
    byRequest.set(request, record);
    signalActivity();
  };
  const onResponse = (response: Response): void => {
    const record = byRequest.get(response.request());
    if (!record) return;
    record.response = response.body()
      .then((body) => ({
        url: record.url,
        pathname: record.pathname,
        resourceType: record.resourceType,
        status: response.status(),
        bytes: body.byteLength,
        byteSource: "body" as const
      }))
      .catch((error: unknown) => {
        const contentLength = response.headers()["content-length"];
        if (/^(?:0|[1-9]\d*)$/.test(contentLength ?? "")) {
          const bytes = Number(contentLength);
          if (Number.isSafeInteger(bytes)) {
            return {
              url: record.url,
              pathname: record.pathname,
              resourceType: record.resourceType,
              status: response.status(),
              bytes,
              byteSource: "content-length" as const
            };
          }
        }
        return {
          url: record.url,
          pathname: record.pathname,
          resourceType: record.resourceType,
          status: response.status(),
          accountingError:
            `Unable to account for response body '${record.url}': ${String(error)}`
        };
      });
  };
  const onRequestFinished = (request: Request): void => {
    const record = byRequest.get(request);
    if (!record) return;
    record.settled = true;
    signalActivity();
  };
  const onRequestFailed = (request: Request): void => {
    const record = byRequest.get(request);
    if (!record) return;
    record.failure = {
      url: record.url,
      pathname: record.pathname,
      resourceType: record.resourceType,
      errorText: request.failure()?.errorText ?? "unknown request failure"
    };
    record.settled = true;
    signalActivity();
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onRequestFinished);
  page.on("requestfailed", onRequestFailed);
  return {
    cursor: () => requests.length,
    async settleFrom(from, options = {}) {
      const deadline = Date.now() + networkStableTimeout;
      networkLoop: while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          const pending = requests
            .slice(from)
            .filter((request) => !request.settled)
            .map((request) => request.url);
          throw new Error(
            `Same-origin network did not settle: ${pending.join(", ") || "activity never became quiet"}`
          );
        }
        if (requests.slice(from).some((request) => !request.settled)) {
          if (!await waitForActivity(remaining)) continue;
          continue;
        }
        const quietDeadline = Date.now() + networkQuietWindow;
        while (Date.now() < quietDeadline) {
          const waitUntil = Math.min(quietDeadline, deadline);
          if (await waitForActivity(Math.max(1, waitUntil - Date.now()))) {
            continue networkLoop;
          }
          if (Date.now() >= deadline) continue networkLoop;
        }
        if (!requests.slice(from).some((request) => !request.settled)) break;
      }

      const scoped = requests.slice(from);
      const failures = scoped.flatMap((request) =>
        request.failure ? [request.failure] : []
      );
      const responses = await Promise.all(
        scoped
          .filter((request) => !request.failure)
          .map((request) => {
            if (!request.response) {
              throw new Error(
                `Completed same-origin request has no response: '${request.url}'.`
              );
            }
            return request.response;
          })
      );
      if (options.requireBodyAccounting) {
        const accountingFailure = responses.find(
          (response) => response.bytes === undefined
        );
        if (accountingFailure) {
          throw new Error(accountingFailure.accountingError);
        }
      }
      return {
        requests: scoped.map(({ url, pathname, resourceType }) => ({
          url,
          pathname,
          resourceType
        })),
        responses,
        failures
      };
    },
    stop: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onRequestFinished);
      page.off("requestfailed", onRequestFailed);
    }
  };
}

async function expectBaseMapReady(page: Page): Promise<void> {
  await expect(page.locator("[data-mode-badge]")).toHaveText("Base Map");
  await expect(page.locator(".reference-surface-backdrop")).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".reference-surface-backdrop").evaluate(
        (image) => (image as HTMLImageElement).naturalWidth
      )
    )
    .toBeGreaterThan(0);
}

test("network ledger records an aborted same-origin request", async ({ page }) => {
  const network = recordNetwork(page);
  await page.goto("/?region=surface&z=-3&x=0&y=0");
  await expectBaseMapReady(page);
  await network.settleFrom(0);
  await page.route("**/network-ledger-aborted", (route) => route.abort("failed"));

  const cursor = network.cursor();
  await page.evaluate(() =>
    fetch("/network-ledger-aborted").catch(() => undefined)
  );
  const snapshot = await network.settleFrom(cursor);
  network.stop();

  expect(snapshot.requests.map((request) => request.pathname)).toEqual([
    "/network-ledger-aborted"
  ]);
  expect(snapshot.responses).toEqual([]);
  expect(snapshot.failures.map((failure) => failure.pathname)).toEqual([
    "/network-ledger-aborted"
  ]);
});

test("network ledger waits for an in-flight response before snapshotting", async ({
  page
}) => {
  let releaseResponse!: () => void;
  let markRequestStarted!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  await page.route("**/network-ledger-delayed", async (route) => {
    markRequestStarted();
    await responseGate;
    await route.fulfill({ status: 200, body: "complete" });
  });
  const network = recordNetwork(page);
  await page.goto("/?region=surface&z=-3&x=0&y=0");
  await expectBaseMapReady(page);
  await network.settleFrom(0);

  const cursor = network.cursor();
  const fetchResult = page.evaluate(() =>
    fetch("/network-ledger-delayed").then((response) => response.text())
  );
  await requestStarted;
  const snapshot = network.settleFrom(cursor);
  releaseResponse();
  await fetchResult;
  const completed = await snapshot;
  network.stop();

  expect(completed.requests.map((request) => request.pathname)).toEqual([
    "/network-ledger-delayed"
  ]);
  expect(completed.responses).toEqual([
    {
      url: `${appOrigin}/network-ledger-delayed`,
      pathname: "/network-ledger-delayed",
      resourceType: "fetch",
      status: 200,
      bytes: 8,
      byteSource: "body"
    }
  ]);
  expect(completed.failures).toEqual([]);
});

type StartupCategory =
  | "entry-document"
  | "code"
  | "stylesheet"
  | "generated-metadata"
  | "reference-data"
  | "reference-image"
  | "sql-wasm"
  | "favicon";

function classifyStartupResponse(
  response: NetworkResponse
): StartupCategory | undefined {
  if (response.pathname === "/" && response.resourceType === "document") {
    return "entry-document";
  }
  if (/^\/assets\/[^/]+\.js$/.test(response.pathname)) return "code";
  if (/^\/assets\/[^/]+\.css$/.test(response.pathname)) return "stylesheet";
  if (
    [
      "/data/generated/build-info.json",
      "/data/generated/regions.json",
      "/data/generated/locations.json"
    ].includes(response.pathname)
  ) {
    return "generated-metadata";
  }
  if (response.pathname === "/data/generated/reference-world.json") {
    return "reference-data";
  }
  if (response.pathname === "/assets/reference-surface-1.0.webp") {
    return "reference-image";
  }
  if (/^\/assets\/sql-wasm-[^/]+\.wasm$/.test(response.pathname)) {
    return "sql-wasm";
  }
  if (/^\/assets\/favicon-[^/]+\.png$/.test(response.pathname)) {
    return "favicon";
  }
  return undefined;
}

test("cold production load keeps optional terrain libraries out of the base map", async ({ page }) => {
  const network = recordNetwork(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?region=surface&z=-3&x=0&y=0");
  await expectBaseMapReady(page);

  const snapshot = await network.settleFrom(0, {
    requireBodyAccounting: true
  });
  network.stop();
  const requestedPaths = snapshot.requests.map((request) => request.pathname);
  const categorized = snapshot.responses.map((response) => ({
    response,
    category: classifyStartupResponse(response)
  }));
  const pathsFor = (category: StartupCategory): string[] =>
    categorized
      .filter((entry) => entry.category === category)
      .map((entry) => entry.response.pathname)
      .sort();
  const startupBytes = snapshot.responses.reduce((total, response) => {
    if (response.bytes === undefined) {
      throw new Error(response.accountingError ?? "Startup bytes are unaccounted.");
    }
    return total + response.bytes;
  }, 0);

  expect(snapshot.failures).toEqual([]);
  expect(snapshot.responses.map((response) => response.url)).toEqual(
    snapshot.requests.map((request) => request.url)
  );
  expect(categorized.filter((entry) => !entry.category)).toEqual([]);
  expect(pathsFor("entry-document")).toEqual(["/"]);
  expect(pathsFor("code").length).toBeGreaterThan(0);
  expect(pathsFor("stylesheet").length).toBeGreaterThan(0);
  expect(pathsFor("generated-metadata")).toEqual([
    "/data/generated/build-info.json",
    "/data/generated/locations.json",
    "/data/generated/regions.json"
  ]);
  expect(pathsFor("reference-data")).toEqual([
    "/data/generated/reference-world.json"
  ]);
  expect(pathsFor("reference-image")).toEqual([
    "/assets/reference-surface-1.0.webp"
  ]);
  expect(pathsFor("sql-wasm")).toEqual(
    requestedPaths
      .filter((pathname) => /^\/assets\/sql-wasm-[^/]+\.wasm$/.test(pathname))
      .sort()
  );
  expect(requestedPaths.filter(optionalPath)).toEqual([]);
  expect(startupBytes).toBeLessThanOrEqual(25 * 1024 * 1024);
});

test("save import requests only its distinct planned legacy assets and reuses them", async ({
  page,
  legacyMapSaves
}) => {
  const network = recordNetwork(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?region=surface&z=-3&x=0&y=0");
  await expectBaseMapReady(page);
  await network.settleFrom(0);
  const save = await legacyMapSaves.createMixed("progressive-mixed.db");
  const expected = [
    "/atlas/official/official-tile-atlas.json",
    "/atlas/official/orthographic-0.webp",
    "/legacy/img/tiles/10105.jpg",
    "/legacy/img/tiles/10106.jpg"
  ].sort();

  const firstImport = network.cursor();
  await page.getByLabel(saveInput).setInputFiles(save.path);
  await expect(page.locator("[data-status]")).toContainText(
    "Your personal map is ready",
    { timeout: mapReadyTimeout }
  );
  const firstPaths = (await network.settleFrom(firstImport)).requests
    .map((request) => request.pathname)
    .filter(optionalPath)
    .sort();
  expect(firstPaths).toEqual(expected);
  expect(new Set(firstPaths).size).toBe(firstPaths.length);
  expect(
    firstPaths.filter((pathname) => pathname.startsWith("/legacy/img/"))
  ).toHaveLength(2);
  expect(
    firstPaths.filter((pathname) => pathname.startsWith("/atlas/official/"))
  ).toHaveLength(2);
  expect(
    firstPaths.filter((pathname) => pathname.startsWith("/legacy/img/")).length
  ).toBeLessThan(334);
  expect(
    firstPaths.filter((pathname) => pathname.startsWith("/atlas/official/")).length
  ).toBeLessThan(19);

  const repeatedImport = network.cursor();
  await page.getByLabel(saveInput).setInputFiles(save.path);
  await expect(page.locator("[data-status]")).toContainText(
    "Your personal map is ready",
    { timeout: mapReadyTimeout }
  );
  const repeatedPaths = (await network.settleFrom(repeatedImport)).requests
    .map((request) => request.pathname)
    .filter(optionalPath);
  network.stop();
  expect(repeatedPaths).toEqual([]);
});

test("an optional terrain request failure keeps the decoded overview usable with a warning", async ({
  page,
  legacyMapSaves
}) => {
  const failedPath = "/legacy/img/tiles/10105.jpg";
  let failedRouteHits = 0;
  await page.route(`**${failedPath}`, async (route) => {
    failedRouteHits += 1;
    await route.fulfill({ status: 503, body: "temporarily unavailable" });
  });
  const network = recordNetwork(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?region=surface&z=-3&x=0&y=0");
  await expectBaseMapReady(page);
  await network.settleFrom(0);
  const save = await legacyMapSaves.createRotations("progressive-fallback.db");

  const importCursor = network.cursor();
  await page.getByLabel(saveInput).setInputFiles(save.path);
  await expect(page.locator("[data-mode-badge]")).toHaveText("Personal Map");
  const canvas = page.locator("canvas[data-terrain-frame='committed']");
  await expect(canvas).toBeVisible();
  await expect(page.locator("[data-status]")).toContainText(
    "The decoded save overview is still available.",
    { timeout: mapReadyTimeout }
  );
  const snapshot = await network.settleFrom(importCursor);
  network.stop();
  const failedResponses = snapshot.responses.filter(
    (response) => response.pathname === failedPath
  );
  const renderedPixels = await canvas.evaluate((element) => {
    const context = element.getContext("2d");
    if (!context || element.width === 0 || element.height === 0) {
      return { width: element.width, height: element.height, nontransparent: 0 };
    }
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let nontransparent = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) nontransparent += 1;
    }
    return { width: element.width, height: element.height, nontransparent };
  });

  expect(failedRouteHits).toBe(1);
  expect(
    snapshot.requests.filter((request) => request.pathname === failedPath)
  ).toHaveLength(1);
  expect(failedResponses).toHaveLength(1);
  expect(failedResponses[0]?.status).toBe(503);
  expect(renderedPixels.width).toBeGreaterThan(0);
  expect(renderedPixels.height).toBeGreaterThan(0);
  expect(renderedPixels.nontransparent).toBeGreaterThan(0);
});
