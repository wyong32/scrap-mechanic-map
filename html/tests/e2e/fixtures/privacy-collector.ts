import type { ConsoleMessage, Page } from "@playwright/test";

export interface PrivacyInspectionError {
  inspectionError: string;
  database?: string;
  store?: string;
  cache?: string;
}

export interface IndexedDbRecordObservation {
  key: unknown;
  primaryKey: unknown;
  value: unknown;
}

export interface IndexedDbIndexObservation {
  name: string;
  keyPath: unknown;
  unique: boolean;
  multiEntry: boolean;
}

export interface IndexedDbStoreObservation {
  name: string;
  keyPath: unknown;
  autoIncrement: boolean;
  indexes: IndexedDbIndexObservation[];
  records: IndexedDbRecordObservation[];
}

export interface IndexedDbDatabaseObservation {
  name: string;
  version: number | undefined;
  stores: IndexedDbStoreObservation[];
}

export interface CacheEntryObservation {
  request: {
    url: string;
    method: string;
    headers: Array<[string, string]>;
    body: Uint8Array;
  };
  response: {
    status: number;
    headers: Array<[string, string]>;
    body: Uint8Array;
  };
}

export interface CacheObservation {
  name: string;
  entries: CacheEntryObservation[];
}

export interface BrowserPrivacyObservation {
  url: string;
  localStorage: Array<[string, string]>;
  databases: IndexedDbDatabaseObservation[];
  caches: CacheObservation[];
  inspectionErrors: PrivacyInspectionError[];
}

export interface BrowserPrivacyCollectorOptions {
  indexedDB?: unknown;
  cacheStorage?: unknown;
  url?: string;
  localStorageEntries?: Array<[string, string]>;
  openTimeoutMs?: number;
  inspectionTimeoutMs?: number;
  scheduleTimeout?: (callback: () => void, milliseconds: number) => () => void;
}

export interface ObjectUrlPrivacyArtifact {
  url: string;
  bytes?: number[];
  inspectionError?: string;
}

export async function installObjectUrlPrivacyCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type PendingObjectUrlArtifact = {
      url: string;
      blob?: Blob;
    };
    const artifacts: PendingObjectUrlArtifact[] = [];
    Object.defineProperty(window, "__privacyObjectUrlArtifacts", {
      value: artifacts
    });
    const createObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = createObjectUrl(object);
      artifacts.push({
        url,
        ...(object instanceof Blob ? { blob: object } : {})
      });
      return url;
    };
  });
}

export async function objectUrlPrivacyCursor(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __privacyObjectUrlArtifacts: unknown[];
        }
      ).__privacyObjectUrlArtifacts.length
  );
}

export async function collectObjectUrlPrivacyArtifacts(
  page: Page,
  cursor: number
): Promise<ObjectUrlPrivacyArtifact[]> {
  return page.evaluate(async (start) => {
    const artifacts = (
      window as Window & {
        __privacyObjectUrlArtifacts: Array<{
          url: string;
          blob?: Blob;
        }>;
      }
    ).__privacyObjectUrlArtifacts.slice(start);
    return Promise.all(
      artifacts.map(async ({ url, blob }) => {
        try {
          const value = blob
            ? [...new Uint8Array(await blob.arrayBuffer())]
            : undefined;
          return {
            url,
            ...(value ? { bytes: value } : {})
          };
        } catch {
          return { url, inspectionError: "object-url.blob" };
        }
      })
    );
  }, cursor);
}

export async function clearObjectUrlPrivacyArtifacts(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as Window & {
        __privacyObjectUrlArtifacts: unknown[];
      }
    ).__privacyObjectUrlArtifacts.length = 0;
  });
}

export async function normalizeBrowserPrivacyValue(value: unknown): Promise<unknown> {
  const seen = new WeakSet<object>();
  const normalize = async (current: unknown): Promise<unknown> => {
    if (!current || typeof current !== "object") return current;
    if (current instanceof ArrayBuffer) return new Uint8Array(current.slice(0));
    if (ArrayBuffer.isView(current)) {
      return new Uint8Array(
        current.buffer,
        current.byteOffset,
        current.byteLength
      ).slice();
    }
    if (typeof Blob !== "undefined" && current instanceof Blob) {
      return new Uint8Array(await current.arrayBuffer());
    }
    if (seen.has(current)) return "[Circular]";
    seen.add(current);
    if (current instanceof Date) {
      try {
        return current.toISOString();
      } catch {
        return String(current);
      }
    }
    if (current instanceof RegExp) {
      return { source: current.source, flags: current.flags };
    }
    if (current instanceof Error) {
      const output: Record<string, unknown> = {
        name: current.name,
        message: current.message,
        stack: current.stack
      };
      if ("cause" in current) output.cause = await normalize(current.cause);
      return output;
    }
    if (Array.isArray(current)) {
      return Promise.all(current.map((entry) => normalize(entry)));
    }
    if (current instanceof Map) {
      const entries: unknown[] = [];
      for (const [key, entry] of current) {
        entries.push([await normalize(key), await normalize(entry)]);
      }
      return { entries };
    }
    if (current instanceof Set) {
      const values: unknown[] = [];
      for (const entry of current) values.push(await normalize(entry));
      return { values };
    }
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(current)) {
      output[key] = await normalize(entry);
    }
    return output;
  };
  return normalize(value);
}

export interface ConsolePrivacyCapture {
  finish(): Promise<unknown[]>;
}

let consoleBoundarySequence = 0;

export function createConsolePrivacyCapture(page: Page): ConsolePrivacyCapture {
  const inspections: Array<Promise<unknown>> = [];
  const boundaryMarker = [
    "__sm_privacy_console_boundary__",
    Date.now(),
    ++consoleBoundarySequence
  ].join(":");
  let resolveBoundary: (() => void) | undefined;
  let finishPromise: Promise<unknown[]> | undefined;

  const onConsole = (message: ConsoleMessage): void => {
    let text: string;
    try {
      text = message.text();
    } catch {
      inspections.push(Promise.resolve({ inspectionError: "console.arguments" }));
      return;
    }
    if (text === boundaryMarker) {
      resolveBoundary?.();
      return;
    }
    try {
      inspections.push(Promise.all(message.args().map((handle) =>
        handle.evaluate(normalizeBrowserPrivacyValue)
      )).then(
        (args) => ({ text, args }),
        () => ({ inspectionError: "console.arguments" })
      ));
    } catch {
      inspections.push(Promise.resolve({ inspectionError: "console.arguments" }));
    }
  };

  page.on("console", onConsole);

  const finish = async (): Promise<unknown[]> => {
    const boundaryReached = new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, 5_000);
      resolveBoundary = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
    });
    try {
      await page.evaluate((marker) => console.debug(marker), boundaryMarker);
      if (!await boundaryReached) {
        inspections.push(Promise.resolve({ inspectionError: "console.boundary" }));
      }
    } catch {
      resolveBoundary?.();
      inspections.push(Promise.resolve({ inspectionError: "console.boundary" }));
    } finally {
      page.off("console", onConsole);
    }
    return Promise.all([...inspections]);
  };

  return {
    finish: () => {
      finishPromise ??= finish();
      return finishPromise;
    }
  };
}

/**
 * This function is intentionally self-contained: Playwright serializes the
 * function body for the real E2E, while focused tests inject event-driven
 * IndexedDB and Cache Storage adapters into the exact same implementation.
 */
export async function collectBrowserPrivacyState(
  options?: BrowserPrivacyCollectorOptions
): Promise<BrowserPrivacyObservation> {
  type Handler = ((event?: {
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => void) | null;
  type OpenRequestLike = {
    result: DatabaseLike;
    error?: unknown;
    onsuccess: Handler;
    onerror: Handler;
    onblocked: Handler;
  };
  type CursorLike = {
    key: unknown;
    primaryKey: unknown;
    value: unknown;
    continue(): void;
  };
  type CursorRequestLike = {
    result: CursorLike | null;
    error?: unknown;
    onsuccess: Handler;
    onerror: Handler;
  };
  type IndexLike = {
    name: string;
    keyPath: unknown;
    unique: boolean;
    multiEntry: boolean;
  };
  type StoreLike = {
    name?: string;
    keyPath: unknown;
    autoIncrement: boolean;
    indexNames: ArrayLike<string>;
    index(name: string): IndexLike;
    openCursor(): CursorRequestLike;
  };
  type TransactionLike = {
    error?: unknown;
    oncomplete: Handler;
    onerror: Handler;
    onabort: Handler;
    objectStore(name: string): StoreLike;
    abort(): void;
  };
  type DatabaseLike = {
    name?: string;
    version?: number;
    objectStoreNames: ArrayLike<string>;
    transaction(names: string[], mode: "readonly"): TransactionLike;
    close(): void;
  };
  type IndexedDbFactoryLike = {
    databases(): Promise<Array<{ name?: string; version?: number }>>;
    open(name: string): OpenRequestLike;
  };
  type RequestLike = {
    url: string;
    method: string;
    headers: Iterable<[string, string]>;
    clone(): { arrayBuffer(): Promise<ArrayBuffer> };
  };
  type ResponseLike = {
    status: number;
    headers: Iterable<[string, string]>;
    clone(): { arrayBuffer(): Promise<ArrayBuffer> };
  };
  type CacheLike = {
    keys(): Promise<RequestLike[]>;
    match(request: RequestLike): Promise<ResponseLike | undefined>;
  };
  type CacheStorageLike = {
    keys(): Promise<string[]>;
    open(name: string): Promise<CacheLike>;
  };

  const runtime = globalThis as typeof globalThis & {
    indexedDB?: IndexedDbFactoryLike;
    caches?: CacheStorageLike;
    location?: { href?: string };
    localStorage?: Storage;
  };
  const supplied = options ?? {};
  const hasOption = (name: keyof BrowserPrivacyCollectorOptions): boolean =>
    Object.prototype.hasOwnProperty.call(supplied, name);
  const indexedDbFactory = (hasOption("indexedDB")
    ? supplied.indexedDB
    : runtime.indexedDB) as IndexedDbFactoryLike | null | undefined;
  const cacheStorage = (hasOption("cacheStorage")
    ? supplied.cacheStorage
    : runtime.caches) as CacheStorageLike | null | undefined;
  const inspectionErrors: PrivacyInspectionError[] = [];
  const databases: IndexedDbDatabaseObservation[] = [];
  const caches: CacheObservation[] = [];
  const recordError = (
    inspectionError: string,
    context: Omit<PrivacyInspectionError, "inspectionError"> = {}
  ): void => {
    inspectionErrors.push({ inspectionError, ...context });
  };
  const stopErrorEvent = (event?: {
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }): void => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
  };
  const scheduleTimeout = supplied.scheduleTimeout ?? ((callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  });
  const openTimeoutMs = supplied.openTimeoutMs ?? 1_000;
  const inspectionTimeoutMs = supplied.inspectionTimeoutMs ?? openTimeoutMs;
  const inspectAsync = <T>(
    operation: () => Promise<T>,
    inspectionError: string,
    context: Omit<PrivacyInspectionError, "inspectionError"> = {}
  ): Promise<{ ok: true; value: T } | { ok: false }> => new Promise((resolve) => {
    let settled = false;
    let cancelTimeout = () => {};
    const finishFailure = (timeout: boolean): void => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      recordError(`${inspectionError}${timeout ? ".timeout" : ""}`, context);
      resolve({ ok: false });
    };
    cancelTimeout = scheduleTimeout(
      () => finishFailure(true),
      inspectionTimeoutMs
    );
    Promise.resolve().then(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        resolve({ ok: true, value });
      },
      () => finishFailure(false)
    );
    if (settled) cancelTimeout();
  });

  let url = supplied.url ?? "";
  if (!hasOption("url")) {
    try {
      url = runtime.location?.href ?? "";
    } catch {
      recordError("location");
    }
  }

  let localStorageEntries = supplied.localStorageEntries ?? [];
  if (!hasOption("localStorageEntries")) {
    try {
      localStorageEntries = runtime.localStorage
        ? Object.entries(runtime.localStorage)
          .map(([key, value]) => [key, String(value)] as [string, string])
        : [];
    } catch {
      recordError("localStorage");
    }
  }

  const openDatabase = async (
    databaseName: string
  ): Promise<DatabaseLike | null> => new Promise((resolve) => {
    let settled = false;
    let cancelTimeout = () => {};
    let request: OpenRequestLike;
    const fail = (inspectionError: string, event?: {
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }): void => {
      stopErrorEvent(event);
      if (settled) return;
      settled = true;
      cancelTimeout();
      recordError(inspectionError, { database: databaseName });
      resolve(null);
    };
    try {
      request = indexedDbFactory!.open(databaseName);
    } catch {
      fail("indexedDB.open.error");
      return;
    }
    request.onerror = (event) => fail("indexedDB.open.error", event);
    request.onblocked = (event) => fail("indexedDB.open.blocked", event);
    request.onsuccess = () => {
      let database: DatabaseLike;
      try {
        database = request.result;
      } catch {
        fail("indexedDB.open.error");
        return;
      }
      if (settled) {
        try {
          database.close();
        } catch {
          recordError("indexedDB.close", { database: databaseName });
        }
        return;
      }
      settled = true;
      cancelTimeout();
      resolve(database);
    };
    cancelTimeout = scheduleTimeout(
      () => fail("indexedDB.open.timeout"),
      openTimeoutMs
    );
    if (settled) cancelTimeout();
  });

  const normalizeStructuredValue = (
    value: unknown,
    seen = new WeakMap<object, unknown>()
  ): unknown => {
    if (!value || typeof value !== "object") return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength
      ).slice();
    }
    const existing = seen.get(value);
    if (existing) return existing;
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      seen.set(value, output);
      value.forEach((entry) => output.push(normalizeStructuredValue(entry, seen)));
      return output;
    }
    if (value instanceof Map) {
      const output: { entries: unknown[] } = { entries: [] };
      seen.set(value, output);
      value.forEach((entry, key) => {
        output.entries.push([
          normalizeStructuredValue(key, seen),
          normalizeStructuredValue(entry, seen)
        ]);
      });
      return output;
    }
    if (value instanceof Set) {
      const output: { values: unknown[] } = { values: [] };
      seen.set(value, output);
      value.forEach((entry) => {
        output.values.push(normalizeStructuredValue(entry, seen));
      });
      return output;
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      throw new Error("Blob inspection requires asynchronous decoding");
    }
    if (value instanceof Date) {
      try {
        return value.toISOString();
      } catch {
        return String(value);
      }
    }
    if (value instanceof RegExp) {
      const output = { source: value.source, flags: value.flags };
      seen.set(value, output);
      return output;
    }
    if (value instanceof Error) {
      const output: Record<string, unknown> = {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
      seen.set(value, output);
      if ("cause" in value) {
        output.cause = normalizeStructuredValue(value.cause, seen);
      }
      return output;
    }
    const output: Record<string, unknown> = {};
    seen.set(value, output);
    Object.entries(value).forEach(([key, entry]) => {
      output[key] = normalizeStructuredValue(entry, seen);
    });
    return output;
  };

  const inspectDatabase = async (
    database: DatabaseLike,
    databaseName: string,
    enumeratedVersion: number | undefined
  ): Promise<IndexedDbDatabaseObservation | null> => {
    const observation: IndexedDbDatabaseObservation = {
      name: databaseName,
      version: database.version ?? enumeratedVersion,
      stores: []
    };
    let completed = false;
    let closed = false;
    try {
      const storeNames = Array.from(database.objectStoreNames);
      if (storeNames.length === 0) {
        completed = true;
      } else {
        let transaction: TransactionLike;
        try {
          transaction = database.transaction(storeNames, "readonly");
        } catch {
          recordError("indexedDB.request", { database: databaseName });
          return null;
        }
        completed = await new Promise<boolean>((resolve) => {
          let settled = false;
          let cancelInspectionTimeout = () => {};
          const pendingCursors = new Set<string>();
          const transactionStore = storeNames.length === 1 ? storeNames[0] : undefined;
          const finish = (
            success: boolean,
            inspectionError?: string,
            store?: string,
            event?: {
              preventDefault?: () => void;
              stopPropagation?: () => void;
            }
          ): void => {
            stopErrorEvent(event);
            if (settled) return;
            settled = true;
            cancelInspectionTimeout();
            if (inspectionError) {
              recordError(inspectionError, {
                database: databaseName,
                ...(store ? { store } : {})
              });
            }
            if (!success && inspectionError !== "indexedDB.transaction.abort") {
              try {
                transaction.abort();
              } catch {
                // The first failure remains the deterministic finding.
              }
            }
            resolve(success);
          };
          transaction.oncomplete = () => finish(true);
          transaction.onerror = (event) => finish(
            false,
            "indexedDB.transaction.error",
            transactionStore,
            event
          );
          transaction.onabort = (event) => finish(
            false,
            "indexedDB.transaction.abort",
            transactionStore,
            event
          );

          for (const storeName of storeNames) {
            if (settled) break;
            let store: StoreLike;
            let storeObservation: IndexedDbStoreObservation;
            let cursorRequest: CursorRequestLike;
            try {
              store = transaction.objectStore(storeName);
              storeObservation = {
                name: storeName,
                keyPath: store.keyPath,
                autoIncrement: store.autoIncrement,
                indexes: Array.from(store.indexNames).map((indexName) => {
                  const index = store.index(indexName);
                  return {
                    name: index.name,
                    keyPath: index.keyPath,
                    unique: index.unique,
                    multiEntry: index.multiEntry
                  };
                }),
                records: []
              };
              observation.stores.push(storeObservation);
              cursorRequest = store.openCursor();
              if (!cursorRequest) throw new Error("Cursor request is unavailable");
              pendingCursors.add(storeName);
            } catch {
              finish(false, "indexedDB.request", storeName);
              break;
            }
            cursorRequest.onerror = (event) => finish(
              false,
              "indexedDB.cursor",
              storeName,
              event
            );
            cursorRequest.onsuccess = () => {
              if (settled) return;
              try {
                const cursor = cursorRequest.result;
                if (!cursor) {
                  pendingCursors.delete(storeName);
                  return;
                }
                storeObservation.records.push({
                  key: normalizeStructuredValue(cursor.key),
                  primaryKey: normalizeStructuredValue(cursor.primaryKey),
                  value: normalizeStructuredValue(cursor.value)
                });
                cursor.continue();
              } catch {
                finish(false, "indexedDB.cursor", storeName);
              }
            };
          }
          cancelInspectionTimeout = scheduleTimeout(() => {
            const pendingStores = [...pendingCursors];
            finish(
              false,
              pendingStores.length > 0
                ? "indexedDB.cursor.timeout"
                : "indexedDB.transaction.timeout",
              pendingStores.length === 1 ? pendingStores[0] : transactionStore
            );
          }, inspectionTimeoutMs);
          if (settled) cancelInspectionTimeout();
        });
      }
    } finally {
      try {
        database.close();
        closed = true;
      } catch {
        recordError("indexedDB.close", { database: databaseName });
      }
    }
    return completed && closed ? observation : null;
  };

  if (!indexedDbFactory || typeof indexedDbFactory.databases !== "function") {
    recordError("indexedDB.unavailable");
  } else {
    const databaseList = await inspectAsync(
      () => indexedDbFactory.databases(),
      "indexedDB.list"
    );
    const databaseInfos = databaseList.ok ? databaseList.value : [];
    for (const databaseInfo of databaseInfos) {
      if (!databaseInfo.name) {
        recordError("indexedDB.request");
        continue;
      }
      const database = await openDatabase(databaseInfo.name);
      if (!database) continue;
      const observation = await inspectDatabase(
        database,
        databaseInfo.name,
        databaseInfo.version
      );
      if (observation) databases.push(observation);
    }
  }

  if (!cacheStorage || typeof cacheStorage.keys !== "function") {
    recordError("cache.unavailable");
  } else {
    const cacheList = await inspectAsync(
      () => cacheStorage.keys(),
      "cache.list"
    );
    const cacheNames = cacheList.ok ? cacheList.value : [];
    for (const cacheName of cacheNames) {
      const openedCache = await inspectAsync(
        () => cacheStorage.open(cacheName),
        "cache.open",
        { cache: cacheName }
      );
      if (!openedCache.ok) continue;
      const cache = openedCache.value;
      const requestList = await inspectAsync(
        () => cache.keys(),
        "cache.request.list",
        { cache: cacheName }
      );
      if (!requestList.ok) continue;
      const requests = requestList.value;
      const cacheObservation: CacheObservation = {
        name: cacheName,
        entries: []
      };
      let failed = false;
      for (const request of requests) {
        let requestFields: {
          url: string;
          method: string;
          headers: Array<[string, string]>;
        };
        try {
          requestFields = {
            url: request.url,
            method: request.method,
            headers: Array.from(request.headers, ([name, value]) => [
              String(name),
              String(value)
            ])
          };
        } catch {
          recordError("cache.request.fields", { cache: cacheName });
          failed = true;
          break;
        }
        const inspectedRequestBody = await inspectAsync(
          () => request.clone().arrayBuffer(),
          "cache.request.body",
          { cache: cacheName }
        );
        if (!inspectedRequestBody.ok) {
          failed = true;
          break;
        }
        const requestBody = new Uint8Array(inspectedRequestBody.value);
        const matchedResponse = await inspectAsync(
          () => cache.match(request),
          "cache.match",
          { cache: cacheName }
        );
        if (!matchedResponse.ok) {
          failed = true;
          break;
        }
        const response = matchedResponse.value;
        if (!response) {
          recordError("cache.response.missing", { cache: cacheName });
          failed = true;
          break;
        }
        let responseFields: {
          status: number;
          headers: Array<[string, string]>;
        };
        try {
          responseFields = {
            status: response.status,
            headers: Array.from(response.headers, ([name, value]) => [
              String(name),
              String(value)
            ])
          };
        } catch {
          recordError("cache.response.fields", { cache: cacheName });
          failed = true;
          break;
        }
        const inspectedResponseBody = await inspectAsync(
          () => response.clone().arrayBuffer(),
          "cache.response.body",
          { cache: cacheName }
        );
        if (!inspectedResponseBody.ok) {
          failed = true;
          break;
        }
        const responseBody = new Uint8Array(inspectedResponseBody.value);
        cacheObservation.entries.push({
          request: { ...requestFields, body: requestBody },
          response: { ...responseFields, body: responseBody }
        });
      }
      if (!failed) caches.push(cacheObservation);
    }
  }

  return {
    url,
    localStorage: localStorageEntries,
    databases,
    caches,
    inspectionErrors
  };
}
