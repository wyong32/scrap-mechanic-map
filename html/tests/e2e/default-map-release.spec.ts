import {
  expect,
  test,
  type Page,
  type Request,
  type Response
} from "@playwright/test";

const appOrigin = "http://127.0.0.1:4175";
const quietWindowMs = 500;
const minimumObservationMs = 2_000;
const settleTimeoutMs = 15_000;

function recordSameOriginRequests(page: Page) {
  const paths: string[] = [];
  const inFlight = new Map<Request, { pathname: string; failed: boolean }>();
  const responses: Array<{ pathname: string; status: number }> = [];
  const failures: Array<{
    pathname: string;
    status?: number;
    errorText: string;
  }> = [];
  let activity = 0;

  const onRequest = (request: Request): void => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin) return;
    paths.push(url.pathname);
    inFlight.set(request, { pathname: url.pathname, failed: false });
    activity += 1;
  };
  const onResponse = (response: Response): void => {
    const record = inFlight.get(response.request());
    if (!record) return;
    const status = response.status();
    responses.push({ pathname: record.pathname, status });
    if (status >= 400) {
      failures.push({
        pathname: record.pathname,
        status,
        errorText: `HTTP ${status}`
      });
      record.failed = true;
    }
    activity += 1;
  };
  const onRequestFinished = (request: Request): void => {
    if (!inFlight.delete(request)) return;
    activity += 1;
  };
  const onRequestFailed = (request: Request): void => {
    const record = inFlight.get(request);
    if (!record) return;
    if (!record.failed) {
      failures.push({
        pathname: record.pathname,
        errorText: request.failure()?.errorText ?? "unknown request failure"
      });
    }
    inFlight.delete(request);
    activity += 1;
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onRequestFinished);
  page.on("requestfailed", onRequestFailed);

  return {
    async settle() {
      const deadline = Date.now() + settleTimeoutMs;
      const observationDeadline = Date.now() + minimumObservationMs;
      let observedActivity = activity;
      let quietSince = observationDeadline;
      let becameQuiet = false;
      while (Date.now() < deadline) {
        if (activity !== observedActivity) {
          observedActivity = activity;
          quietSince = Math.max(Date.now(), observationDeadline);
        }
        if (
          Date.now() >= observationDeadline
          && inFlight.size === 0
          && Date.now() - quietSince >= quietWindowMs
        ) {
          becameQuiet = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!becameQuiet) {
        throw new Error(
          `Same-origin network did not become quiet; in flight: ${
            [...inFlight.values()].map((record) => record.pathname).join(", ")
              || "none"
          }`
        );
      }

      return {
        paths,
        responses,
        failures,
        get inFlight() {
          return [...inFlight.values()].map((record) => record.pathname);
        }
      };
    },
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onRequestFinished);
      page.off("requestfailed", onRequestFailed);
    }
  };
}

test("request ledger fails closed on a same-origin HTTP error", async ({
  page
}) => {
  await page.route("**/network-ledger-http-error", (route) =>
    route.fulfill({ status: 503, body: "unavailable" })
  );
  const network = recordSameOriginRequests(page);
  await page.goto("/?region=surface&z=-3&x=0&y=0");
  await page.evaluate(() => fetch("/network-ledger-http-error"));

  const snapshot = await network.settle();

  expect(snapshot.failures).toEqual([
    {
      pathname: "/network-ledger-http-error",
      status: 503,
      errorText: "HTTP 503"
    }
  ]);
  network.stop();
});

test("request ledger observes a forbidden request delayed after map readiness", async ({
  page
}) => {
  await page.route("**/assets/save-client-late.js", (route) =>
    route.fulfill({ status: 200, body: "export {};" })
  );
  const network = recordSameOriginRequests(page);
  await page.goto("/?region=surface&z=-3&x=0&y=0");
  await expect(page.locator(".reference-surface-backdrop")).toBeVisible();
  await page.evaluate(() => {
    window.setTimeout(() => {
      void fetch("/assets/save-client-late.js");
    }, 2_100);
  });

  const snapshot = await network.settle();

  expect(snapshot.paths).toContain("/assets/save-client-late.js");
  network.stop();
});

test("default production release is a useful lightweight base map", async ({
  page
}) => {
  const network = recordSameOriginRequests(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?region=surface&z=-3&x=0&y=0");

  await expect(page.getByRole("region", { name: "Interactive Map" })).toBeVisible();
  const surfaceWorld = page.getByRole("button", { name: "Surface World" }).first();
  await expect(surfaceWorld).toBeVisible();
  await expect(surfaceWorld).toBeEnabled();
  const locationNames = page.locator("input[data-location-master]");
  await expect(locationNames).toBeVisible();
  await expect(locationNames).toBeEnabled();
  await expect(page.getByText("Location Names", { exact: true })).toBeVisible();
  const searchInput = page.getByRole("searchbox", { name: "Search Locations" });
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeEnabled();
  const searchButton = page.getByRole("button", { name: "SEARCH", exact: true });
  await expect(searchButton).toBeVisible();
  await expect(searchButton).toBeEnabled();
  const addMarker = page.getByRole("button", { name: "Add Marker", exact: true });
  await expect(addMarker).toBeVisible();
  await expect(addMarker).toBeEnabled();
  await expect(page.locator(".reference-surface-backdrop")).toBeVisible();
  await expect.poll(() => page.locator(".reference-surface-backdrop").evaluate(
    (image) => (image as HTMLImageElement).naturalWidth
  )).toBeGreaterThan(0);

  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.locator("[data-save-drop-zone]")).toHaveCount(0);
  await expect(page.locator("[data-save-path-hint]")).toHaveCount(0);
  await expect(page.getByText("Select Save", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Replace Save", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Personal Map", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Exit Personal Map", { exact: true })).toHaveCount(0);

  const snapshot = await network.settle();
  const forbiddenPaths = snapshot.paths.filter((pathname) =>
    /save-client|save-worker|sql(?:ite)?(?:\.js|-js|-asm|-wasm)|default-save\.db/i
      .test(pathname)
    || pathname === "/data/generated/tile-catalog.json"
    || pathname === "/data/generated/default-surface-orthographic-inventory.json"
    || pathname.startsWith("/legacy/img/")
    || pathname.startsWith("/atlas/official/")
  );
  const expectedStartupPath = (pathname: string): boolean =>
    pathname === "/"
    || /^\/assets\/index-[^/]+\.(?:js|css)$/.test(pathname)
    || pathname === "/data/generated/build-info.json"
    || pathname === "/data/generated/regions.json"
    || pathname === "/data/generated/locations.json"
    || pathname === "/data/generated/reference-world.json"
    || pathname === "/assets/reference-surface-1.0.webp"
    || /^\/assets\/favicon-[^/]+\.png$/.test(pathname);
  const unexpectedPaths = snapshot.paths.filter(
    (pathname) => !expectedStartupPath(pathname)
  );

  console.log("default-map-release-ledger", JSON.stringify({
    requests: snapshot.paths.length,
    failed: snapshot.failures.length,
    inFlight: snapshot.inFlight.length,
    paths: snapshot.paths
  }));
  expect(forbiddenPaths).toEqual([]);
  expect(unexpectedPaths).toEqual([]);
  expect(snapshot.failures).toEqual([]);
  expect(snapshot.responses).toHaveLength(snapshot.paths.length);
  expect(snapshot.responses.filter((response) => response.status >= 400))
    .toEqual([]);
  expect(snapshot.inFlight).toEqual([]);
  network.stop();
});
