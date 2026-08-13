import { expect, test } from "@playwright/test";
import {
  collectBrowserPrivacyState,
  createConsolePrivacyCapture,
  normalizeBrowserPrivacyValue,
  type BrowserPrivacyCollectorOptions
} from "./fixtures/privacy-collector";
import { findPrivacyLeaks, type PrivacySecret } from "./fixtures/privacy-scanner";

type EventHandler = ((event: { preventDefault(): void; stopPropagation(): void }) => void) | null;
type StoreFixture = {
  name: string;
  keyPath?: string | string[] | null;
  autoIncrement?: boolean;
  indexes?: Array<{
    name: string;
    keyPath?: string | string[] | null;
    unique?: boolean;
    multiEntry?: boolean;
  }>;
  records?: Array<{ key: unknown; primaryKey: unknown; value: unknown }>;
};

type IndexedDbMode =
  | "success"
  | "open-error"
  | "open-blocked"
  | "open-timeout"
  | "transaction-error"
  | "transaction-abort"
  | "request-error"
  | "cursor-error"
  | "cursor-continue-error"
  | "cursor-silent"
  | "transaction-silent";

const inspectionSecret: PrivacySecret = {
  name: "unused",
  bytes: new Uint8Array([222, 173, 190, 239]),
  forms: ["unused-secret"]
};

const browserEvent = {
  preventDefault() {},
  stopPropagation() {}
};

function createIndexedDbHarness(
  mode: IndexedDbMode,
  stores: StoreFixture[] = []
): {
  options: BrowserPrivacyCollectorOptions;
  closeCount(): number;
  transactionCalls(): number;
} {
  let closes = 0;
  let transactions = 0;
  const databaseName = "private-db";
  const openRequest: {
    result: unknown;
    error: unknown;
    onsuccess: EventHandler;
    onerror: EventHandler;
    onblocked: EventHandler;
  } = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onblocked: null
  };

  const database = {
    name: databaseName,
    version: 7,
    objectStoreNames: stores.map((store) => store.name),
    close() {
      closes += 1;
    },
    transaction() {
      transactions += 1;
      if (stores.length === 0) throw new Error("transaction must not be called for an empty database");
      let completedStores = 0;
      const transaction: {
        error: unknown;
        oncomplete: EventHandler;
        onerror: EventHandler;
        onabort: EventHandler;
        abort(): void;
        objectStore(name: string): unknown;
      } = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort() {
          queueMicrotask(() => transaction.onabort?.(browserEvent));
        },
        objectStore(name: string) {
          const fixture = stores.find((store) => store.name === name);
          if (!fixture) throw new Error(`Unknown store: ${name}`);
          const indexes = fixture.indexes ?? [];
          return {
            name,
            keyPath: fixture.keyPath ?? null,
            autoIncrement: fixture.autoIncrement ?? false,
            indexNames: indexes.map((index) => index.name),
            index(indexName: string) {
              const index = indexes.find((entry) => entry.name === indexName);
              if (!index) throw new Error(`Unknown index: ${indexName}`);
              return {
                name: index.name,
                keyPath: index.keyPath ?? null,
                unique: index.unique ?? false,
                multiEntry: index.multiEntry ?? false
              };
            },
            openCursor() {
              if (mode === "request-error") throw new Error("request creation failed");
              const cursorRequest: {
                result: unknown;
                error: unknown;
                onsuccess: EventHandler;
                onerror: EventHandler;
              } = {
                result: undefined,
                error: null,
                onsuccess: null,
                onerror: null
              };
              if (mode === "transaction-error" || mode === "transaction-abort") return cursorRequest;
              if (mode === "cursor-silent") return cursorRequest;
              if (mode === "cursor-error") {
                queueMicrotask(() => {
                  cursorRequest.error = new Error("cursor request failed");
                  cursorRequest.onerror?.(browserEvent);
                  transaction.error = new Error("bubbled cursor error");
                  transaction.onerror?.(browserEvent);
                  transaction.onabort?.(browserEvent);
                });
                return cursorRequest;
              }
              const records = fixture.records ?? [];
              let recordIndex = 0;
              const emit = () => {
                if (recordIndex >= records.length) {
                  cursorRequest.result = null;
                  cursorRequest.onsuccess?.(browserEvent);
                  completedStores += 1;
                  if (completedStores === stores.length && mode !== "transaction-silent") {
                    queueMicrotask(() => transaction.oncomplete?.(browserEvent));
                  }
                  return;
                }
                const record = records[recordIndex]!;
                cursorRequest.result = {
                  ...record,
                  continue() {
                    if (mode === "cursor-continue-error") throw new Error("cursor continue failed");
                    recordIndex += 1;
                    queueMicrotask(emit);
                  }
                };
                cursorRequest.onsuccess?.(browserEvent);
              };
              queueMicrotask(emit);
              return cursorRequest;
            }
          };
        }
      };
      if (mode === "transaction-error") {
        queueMicrotask(() => {
          transaction.error = new Error("transaction failed");
          transaction.onerror?.(browserEvent);
        });
      }
      if (mode === "transaction-abort") {
        queueMicrotask(() => transaction.onabort?.(browserEvent));
      }
      return transaction;
    }
  };

  const indexedDB = {
    async databases() {
      return [{ name: databaseName, version: 7 }];
    },
    open() {
      if (mode === "open-error") {
        queueMicrotask(() => {
          openRequest.error = new Error("open failed");
          openRequest.onerror?.(browserEvent);
        });
      } else if (mode === "open-blocked") {
        queueMicrotask(() => {
          openRequest.onblocked?.(browserEvent);
          queueMicrotask(() => {
            openRequest.result = database;
            openRequest.onsuccess?.(browserEvent);
          });
        });
      } else if (mode !== "open-timeout") {
        queueMicrotask(() => {
          openRequest.result = database;
          openRequest.onsuccess?.(browserEvent);
        });
      }
      return openRequest;
    }
  };

  const scheduleTimeout = (callback: () => void): (() => void) => {
    if (
      mode === "open-timeout" ||
      mode === "cursor-silent" ||
      mode === "transaction-silent"
    ) {
      let cancelled = false;
      const timer = setTimeout(() => {
        if (cancelled) return;
        callback();
        if (mode === "open-timeout") queueMicrotask(() => {
          openRequest.result = database;
          openRequest.onsuccess?.(browserEvent);
        });
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    return () => {};
  };

  return {
    options: {
      indexedDB,
      cacheStorage: { keys: async () => [] },
      url: "https://example.test/",
      localStorageEntries: [],
      openTimeoutMs: 10,
      scheduleTimeout
    },
    closeCount: () => closes,
    transactionCalls: () => transactions
  };
}

test("collector returns empty database metadata without opening a transaction", async () => {
  const harness = createIndexedDbHarness("success");
  const observation = await collectBrowserPrivacyState(harness.options);
  expect(observation).toMatchObject({
    databases: [{ name: "private-db", version: 7, stores: [] }],
    inspectionErrors: []
  });
  expect(harness.transactionCalls()).toBe(0);
  expect(harness.closeCount()).toBe(1);
});

test("collector keeps empty store and index metadata", async () => {
  const harness = createIndexedDbHarness("success", [{
    name: "private-store",
    keyPath: "id",
    autoIncrement: true,
    indexes: [{
      name: "private-index",
      keyPath: ["seed", "flag"],
      unique: true,
      multiEntry: false
    }]
  }]);
  const observation = await collectBrowserPrivacyState(harness.options);
  expect(observation).toMatchObject({
    databases: [{
      name: "private-db",
      version: 7,
      stores: [{
        name: "private-store",
        keyPath: "id",
        autoIncrement: true,
        indexes: [{
          name: "private-index",
          keyPath: ["seed", "flag"],
          unique: true,
          multiEntry: false
        }],
        records: []
      }]
    }],
    inspectionErrors: []
  });
  expect(harness.closeCount()).toBe(1);
});

test("collector keeps cursor key, primaryKey, value, and typed-view boundaries", async () => {
  const backing = new Uint8Array([1, 222, 173, 190, 239, 2]);
  const view = new Uint8Array(backing.buffer, 1, 4);
  const harness = createIndexedDbHarness("success", [{
    name: "records",
    records: [{ key: "key", primaryKey: 919191, value: view }]
  }]);
  const observation = await collectBrowserPrivacyState(harness.options) as {
    databases: Array<{ stores: Array<{ records: Array<{ key: unknown; primaryKey: unknown; value: Uint8Array }> }> }>;
    inspectionErrors: unknown[];
  };
  const record = observation.databases[0]!.stores[0]!.records[0]!;
  expect(record.key).toBe("key");
  expect(record.primaryKey).toBe(919191);
  expect(Array.from(new Uint8Array(
    record.value.buffer,
    record.value.byteOffset,
    record.value.byteLength
  ))).toEqual([222, 173, 190, 239]);
  expect(observation.inspectionErrors).toEqual([]);
  expect(harness.closeCount()).toBe(1);
});

test("actual browser collector preserves raw ArrayBuffers and typed-view boundaries", async ({
  page,
  browserName
}) => {
  const databaseName = `privacy-collector-roundtrip-${browserName}`;
  const sentinel = [222, 173, 190, 239];
  await page.goto("/");
  const deleteDatabase = () => page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Deletion blocked for ${name}`));
  }), databaseName);
  await deleteDatabase();
  try {
    await page.evaluate(({ name, bytes }) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("records");
        store.createIndex("marker", "marker");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("records", "readwrite");
        const backing = new Uint8Array(bytes.length + 2);
        backing.set(bytes, 1);
        const raw = Uint8Array.from(bytes).buffer;
        transaction.objectStore("records").put({
          marker: "private",
          raw,
          view: new Uint8Array(backing.buffer, 1, bytes.length),
          error: new Error("private-error"),
          pattern: /private-pattern/,
          integer: 919191n
        }, raw.slice(0));
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error("Fixture transaction aborted"));
        };
      };
    }), { name: databaseName, bytes: sentinel });

    const observation = await page.evaluate(collectBrowserPrivacyState, undefined);
    const database = observation.databases.find((entry) => entry.name === databaseName);
    expect(database).toMatchObject({
      stores: [{
        name: "records",
        indexes: [{ name: "marker" }]
      }]
    });
    const record = database!.stores[0]!.records[0]!;
    const asBytes = (value: unknown): number[] => {
      expect(ArrayBuffer.isView(value)).toBe(true);
      const view = value as Uint8Array;
      return Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    };
    expect(asBytes(record.key)).toEqual(sentinel);
    expect(asBytes(record.primaryKey)).toEqual(sentinel);
    const value = record.value as {
      raw: unknown;
      view: unknown;
      error: unknown;
      pattern: unknown;
      integer: unknown;
    };
    expect(asBytes(value.raw)).toEqual(sentinel);
    expect(asBytes(value.view)).toEqual(sentinel);
    expect(findPrivacyLeaks(value.error, [{
      name: "idb Error",
      bytes: new Uint8Array(),
      forms: ["private-error"]
    }])).toEqual(["idb Error"]);
    expect(findPrivacyLeaks(value.pattern, [{
      name: "idb RegExp",
      bytes: new Uint8Array(),
      forms: ["private-pattern"]
    }])).toEqual(["idb RegExp"]);
    expect(findPrivacyLeaks(value.integer, [{
      name: "idb bigint",
      bytes: new Uint8Array(),
      forms: ["919191"]
    }])).toEqual(["idb bigint"]);
    expect(observation.inspectionErrors).toEqual([]);
  } finally {
    await deleteDatabase();
  }
});

test("actual console normalization preserves a raw ArrayBuffer for the scanner", async ({
  page
}) => {
  const sentinel = new Uint8Array([222, 173, 190, 239, 17, 34, 51, 68]);
  const secret: PrivacySecret = {
    name: "console raw",
    bytes: sentinel,
    forms: []
  };
  await page.goto("/");
  const messagePromise = page.waitForEvent("console");
  await page.evaluate((bytes) => {
    console.log(Uint8Array.from(bytes).buffer);
  }, Array.from(sentinel));
  const message = await messagePromise;
  const args = await Promise.all(message.args().map((handle) =>
    handle.evaluate(normalizeBrowserPrivacyValue)
  ));
  expect(findPrivacyLeaks({ consoleMessages: [{ args }] }, [secret]))
    .toEqual(["console raw"]);
});

const consoleStructuredCarriers = [
  {
    name: "Error",
    secret: "private-error",
    create: (value: string) => new Error(value)
  },
  {
    name: "RegExp",
    secret: "private-pattern",
    create: (value: string) => new RegExp(value)
  },
  {
    name: "bigint",
    secret: "919191",
    create: (value: string) => BigInt(value)
  }
] as const;

for (const carrier of consoleStructuredCarriers) {
  test(`actual console normalization exposes a nested ${carrier.name} to the scanner`, async ({
    page
  }) => {
    await page.goto("/");
    const messagePromise = page.waitForEvent("console");
    await page.evaluate(({ kind, secret }) => {
      const value = kind === "Error"
        ? new Error(secret)
        : kind === "RegExp"
          ? new RegExp(secret)
          : BigInt(secret);
      console.log({ nested: value });
    }, { kind: carrier.name, secret: carrier.secret });
    const message = await messagePromise;
    const args = await Promise.all(message.args().map((handle) =>
      handle.evaluate(normalizeBrowserPrivacyValue)
    ));
    expect(findPrivacyLeaks({ args }, [{
      name: carrier.name,
      bytes: new Uint8Array(),
      forms: [carrier.secret]
    }])).toEqual([carrier.name]);
  });
}

const indexedDbFailures: Array<{
  mode: IndexedDbMode;
  code: string;
  store?: boolean;
  lateDatabase?: boolean;
}> = [
  { mode: "open-error", code: "indexedDB.open.error" },
  { mode: "open-blocked", code: "indexedDB.open.blocked", lateDatabase: true },
  { mode: "open-timeout", code: "indexedDB.open.timeout", lateDatabase: true },
  { mode: "transaction-error", code: "indexedDB.transaction.error", store: true },
  { mode: "transaction-abort", code: "indexedDB.transaction.abort", store: true },
  { mode: "request-error", code: "indexedDB.request", store: true },
  { mode: "cursor-error", code: "indexedDB.cursor", store: true },
  { mode: "cursor-continue-error", code: "indexedDB.cursor", store: true },
  { mode: "cursor-silent", code: "indexedDB.cursor.timeout", store: true },
  { mode: "transaction-silent", code: "indexedDB.transaction.timeout", store: true }
];

for (const { mode, code, store, lateDatabase } of indexedDbFailures) {
  test(`collector records ${mode} deterministically and fails closed`, async () => {
    const harness = createIndexedDbHarness(mode, store ? [{
      name: "private-store",
      records: mode === "cursor-continue-error"
        ? [{ key: "key", primaryKey: "primary", value: "value" }]
        : []
    }] : []);
    const collection = collectBrowserPrivacyState(harness.options);
    const observation = await Promise.race([
      collection,
      new Promise<"watchdog">((resolve) => setTimeout(() => resolve("watchdog"), 100))
    ]);
    expect(observation).not.toBe("watchdog");
    if (observation === "watchdog") return;
    const typedObservation = observation as {
      databases: unknown[];
      inspectionErrors: unknown[];
    };
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(typedObservation.databases).toEqual([]);
    expect(typedObservation.inspectionErrors).toEqual([{
      inspectionError: code,
      database: "private-db",
      ...(store ? { store: "private-store" } : {})
    }]);
    expect(findPrivacyLeaks(typedObservation, [inspectionSecret])).toEqual([`inspection:${code}`]);
    expect(harness.closeCount()).toBe(lateDatabase || store ? 1 : 0);
  });
}

test("console capture drains its boundary, detaches, and stays stable", async ({
  page
}) => {
  const preBoundarySecret = "private-pre-boundary-console";
  const lateSecret = "private-post-boundary-console";
  await page.goto("/");
  const baselineConsoleListeners = page.listenerCount("console");
  const capture = createConsolePrivacyCapture(page);
  expect(page.listenerCount("console")).toBe(baselineConsoleListeners + 1);

  const preBoundaryEmission = page.evaluate((value) => {
    const delayedBytes = new Blob([value]);
    const readBytes = delayedBytes.arrayBuffer.bind(delayedBytes);
    delayedBytes.arrayBuffer = async () => {
      await new Promise<void>((release) => setTimeout(release, 0));
      return readBytes();
    };
    console.log({
      phase: "pre-boundary",
      structured: new Error(value),
      delayedBytes
    });
  }, preBoundarySecret);
  const finishPromise = capture.finish();
  const [messages] = await Promise.all([finishPromise, preBoundaryEmission]);

  expect(page.listenerCount("console")).toBe(baselineConsoleListeners);
  expect(findPrivacyLeaks({ consoleMessages: messages }, [{
    name: "pre-boundary console",
    bytes: new Uint8Array(),
    forms: [preBoundarySecret]
  }])).toEqual(["pre-boundary console"]);
  expect(messages).not.toContainEqual(expect.objectContaining({
    inspectionError: expect.any(String)
  }));
  const stableSnapshot = structuredClone(messages);
  const stableLength = messages.length;

  const lateMessageObserved = page.waitForEvent(
    "console",
    (message) => message.text().includes("post-boundary")
  );
  const lateEmission = page.evaluate(({ label, value }) => {
    console.log(label, { structured: new Error(value) });
  }, { label: "post-boundary", value: lateSecret });
  await Promise.all([lateMessageObserved, lateEmission]);

  const repeatedMessages = await capture.finish();
  expect(page.listenerCount("console")).toBe(baselineConsoleListeners);
  expect(repeatedMessages).toBe(messages);
  expect(repeatedMessages).toEqual(stableSnapshot);
  expect(repeatedMessages).toHaveLength(stableLength);
  expect(findPrivacyLeaks({ consoleMessages: repeatedMessages }, [{
    name: "post-boundary console",
    bytes: new Uint8Array(),
    forms: ["post-boundary", lateSecret]
  }])).toEqual([]);
  expect(repeatedMessages).not.toContainEqual(expect.objectContaining({
    inspectionError: expect.any(String)
  }));
});

type CacheFailure =
  | "list"
  | "open"
  | "request-list"
  | "request-fields"
  | "request-body"
  | "match"
  | "missing-response"
  | "response-fields"
  | "response-body";

type CacheTimeout =
  | "list-timeout"
  | "open-timeout"
  | "request-list-timeout"
  | "request-body-timeout"
  | "match-timeout"
  | "response-body-timeout";

function bytesBody(
  value: number[],
  fail = false,
  silent = false
): { clone(): { arrayBuffer(): Promise<ArrayBuffer> } } {
  return {
    clone() {
      return {
        async arrayBuffer() {
          if (silent) return new Promise<ArrayBuffer>(() => {});
          if (fail) throw new Error("body inspection failed");
          return Uint8Array.from(value).buffer;
        }
      };
    }
  };
}

function createCacheStorage(mode?: CacheFailure | CacheTimeout): unknown {
  const requestBody = bytesBody(
    [222, 173, 190, 239],
    mode === "request-body",
    mode === "request-body-timeout"
  );
  const responseBody = bytesBody(
    [219, 2, 0, 0],
    mode === "response-body",
    mode === "response-body-timeout"
  );
  const request = {
    get url() {
      if (mode === "request-fields") throw new Error("request fields failed");
      return "https://example.test/private";
    },
    method: "POST",
    headers: [["x-private", "919191"]],
    ...requestBody
  };
  const response = {
    get status() {
      if (mode === "response-fields") throw new Error("response fields failed");
      return 299;
    },
    headers: [["x-decoded", "731"]],
    ...responseBody
  };
  const cache = {
    async keys() {
      if (mode === "request-list-timeout") return new Promise<never>(() => {});
      if (mode === "request-list") throw new Error("request list failed");
      return [request];
    },
    async match() {
      if (mode === "match-timeout") return new Promise<never>(() => {});
      if (mode === "match") throw new Error("match failed");
      if (mode === "missing-response") return undefined;
      return response;
    }
  };
  return {
    async keys() {
      if (mode === "list-timeout") return new Promise<never>(() => {});
      if (mode === "list") throw new Error("cache list failed");
      return ["private-cache"];
    },
    async open() {
      if (mode === "open-timeout") return new Promise<never>(() => {});
      if (mode === "open") throw new Error("cache open failed");
      return cache;
    }
  };
}

const emptyIndexedDb = {
  async databases() {
    return [];
  },
  open() {
    throw new Error("open must not be called");
  }
};

test("collector keeps empty cache names", async () => {
  const observation = await collectBrowserPrivacyState({
    indexedDB: emptyIndexedDb,
    cacheStorage: {
      keys: async () => ["private-cache"],
      open: async () => ({ keys: async () => [] })
    },
    url: "https://example.test/",
    localStorageEntries: []
  });
  expect(observation).toMatchObject({
    caches: [{ name: "private-cache", entries: [] }],
    inspectionErrors: []
  });
});

test("collector keeps every cache field and raw request/response bytes", async () => {
  const observation = await collectBrowserPrivacyState({
    indexedDB: emptyIndexedDb,
    cacheStorage: createCacheStorage(),
    url: "https://example.test/",
    localStorageEntries: []
  });
  expect(observation).toMatchObject({
    caches: [{
      name: "private-cache",
      entries: [{
        request: {
          url: "https://example.test/private",
          method: "POST",
          headers: [["x-private", "919191"]],
          body: new Uint8Array([222, 173, 190, 239])
        },
        response: {
          status: 299,
          headers: [["x-decoded", "731"]],
          body: new Uint8Array([219, 2, 0, 0])
        }
      }]
    }],
    inspectionErrors: []
  });
});

const cacheFailures: Array<[CacheFailure | "unavailable", string]> = [
  ["unavailable", "cache.unavailable"],
  ["list", "cache.list"],
  ["open", "cache.open"],
  ["request-list", "cache.request.list"],
  ["request-fields", "cache.request.fields"],
  ["request-body", "cache.request.body"],
  ["match", "cache.match"],
  ["missing-response", "cache.response.missing"],
  ["response-fields", "cache.response.fields"],
  ["response-body", "cache.response.body"]
];

for (const [mode, code] of cacheFailures) {
  test(`collector records cache ${mode} independently and fails closed`, async () => {
    const observation = await collectBrowserPrivacyState({
      indexedDB: emptyIndexedDb,
      cacheStorage: mode === "unavailable" ? null : createCacheStorage(mode),
      url: "https://example.test/",
      localStorageEntries: []
    } as BrowserPrivacyCollectorOptions) as {
      caches: unknown[];
      inspectionErrors: unknown[];
    };
    expect(observation.caches).toEqual([]);
    expect(observation.inspectionErrors).toEqual([{
      inspectionError: code,
      ...(mode === "unavailable" || mode === "list" ? {} : { cache: "private-cache" })
    }]);
    expect(findPrivacyLeaks(observation, [inspectionSecret])).toEqual([`inspection:${code}`]);
  });
}

const cacheTimeouts: Array<[CacheTimeout, string]> = [
  ["list-timeout", "cache.list.timeout"],
  ["open-timeout", "cache.open.timeout"],
  ["request-list-timeout", "cache.request.list.timeout"],
  ["request-body-timeout", "cache.request.body.timeout"],
  ["match-timeout", "cache.match.timeout"],
  ["response-body-timeout", "cache.response.body.timeout"]
];

for (const [mode, code] of cacheTimeouts) {
  test(`collector records silent cache ${mode} independently and fails closed`, async () => {
    const scheduleTimeout = (callback: () => void): (() => void) => {
      const timer = setTimeout(callback, 0);
      return () => clearTimeout(timer);
    };
    const collection = collectBrowserPrivacyState({
      indexedDB: emptyIndexedDb,
      cacheStorage: createCacheStorage(mode),
      url: "https://example.test/",
      localStorageEntries: [],
      openTimeoutMs: 1,
      scheduleTimeout
    });
    const observation = await Promise.race([
      collection,
      new Promise<"watchdog">((resolve) => setTimeout(() => resolve("watchdog"), 100))
    ]);
    expect(observation).not.toBe("watchdog");
    if (observation === "watchdog") return;
    expect(observation.caches).toEqual([]);
    expect(observation.inspectionErrors).toEqual([{
      inspectionError: code,
      ...(mode === "list-timeout" ? {} : { cache: "private-cache" })
    }]);
    expect(findPrivacyLeaks(observation, [inspectionSecret])).toEqual([`inspection:${code}`]);
  });
}
