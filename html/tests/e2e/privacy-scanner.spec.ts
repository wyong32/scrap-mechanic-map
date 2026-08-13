import { expect, test } from "@playwright/test";
import {
  createInt32PrivacySecret,
  findPrivacyFindings,
  findPrivacyLeaks,
  type PrivacySecret
} from "./fixtures/privacy-scanner";
import {
  SYNTHETIC_BINARY_SENTINEL,
  SYNTHETIC_DECODED_SENTINEL,
  SYNTHETIC_PRIVACY_SEED
} from "./fixtures/synthetic-save";

const bytes = Uint8Array.from(SYNTHETIC_BINARY_SENTINEL);
const offsetBuffer = new Uint8Array(bytes.length + 2);
offsetBuffer.set(bytes, 1);

const binarySecret: PrivacySecret = {
  name: "binary",
  bytes,
  forms: [
    "deadbeef11223344",
    Buffer.from(bytes).toString("base64"),
    "synthetic-name.db"
  ]
};

const scannerCases: Array<[string, unknown, PrivacySecret]> = [
  ["URL", { url: "https://example.test/synthetic-name.db" }, binarySecret],
  ["localStorage key", { localStorage: [["synthetic-name.db", "safe"]] }, binarySecret],
  ["localStorage value", { localStorage: [["safe", "synthetic-name.db"]] }, binarySecret],
  ["request text", { requests: [{ text: "synthetic-name.db" }] }, binarySecret],
  ["request raw embedded", { requests: [{ body: Buffer.concat([Buffer.from([1]), Buffer.from(bytes), Buffer.from([2])]) }] }, binarySecret],
  ["decimal plain array", JSON.parse(JSON.stringify(Array.from(bytes))), binarySecret],
  ["direct ArrayBuffer", bytes.buffer.slice(0), binarySecret],
  ["typed array offset", new Uint8Array(offsetBuffer.buffer, 1, bytes.length), binarySecret],
  ["idb database name", { databases: [{ name: "synthetic-name.db", version: 1, stores: [] }] }, binarySecret],
  ["idb store name", { databases: [{ name: "safe", version: 1, stores: [{ name: "synthetic-name.db", indexes: [], records: [] }] }] }, binarySecret],
  ["idb index name", { databases: [{ name: "safe", version: 1, stores: [{ name: "safe", indexes: [{ name: "synthetic-name.db" }], records: [] }] }] }, binarySecret],
  ["idb cursor key", { databases: [{ name: "safe", version: 1, stores: [{ name: "safe", indexes: [], records: [{ key: Array.from(bytes) }] }] }] }, binarySecret],
  ["idb cursor primaryKey", { databases: [{ name: "safe", version: 1, stores: [{ name: "safe", indexes: [], records: [{ primaryKey: Array.from(bytes) }] }] }] }, binarySecret],
  ["idb cursor value", { databases: [{ name: "safe", version: 1, stores: [{ name: "safe", indexes: [], records: [{ value: Array.from(bytes) }] }] }] }, binarySecret],
  ["cache name", { caches: [{ name: "synthetic-name.db", entries: [] }] }, binarySecret],
  ["cache request URL", { caches: [{ name: "safe", entries: [{ request: { url: "https://example.test/synthetic-name.db" } }] }] }, binarySecret],
  ["cache request method", { caches: [{ name: "safe", entries: [{ request: { method: "deadbeef11223344" } }] }] }, binarySecret],
  ["cache request headers", { caches: [{ name: "safe", entries: [{ request: { headers: [["x-private", "synthetic-name.db"]] } }] }] }, binarySecret],
  ["cache request raw body", { caches: [{ name: "safe", entries: [{ request: { body: Buffer.from(bytes) } }] }] }, binarySecret],
  ["cache response headers", { caches: [{ name: "safe", entries: [{ response: { headers: [["x-private", "synthetic-name.db"]] } }] }] }, binarySecret],
  ["cache response raw body", { caches: [{ name: "safe", entries: [{ response: { body: Buffer.from(bytes) } }] }] }, binarySecret],
  ["console text", { consoleMessages: [{ text: "synthetic-name.db" }] }, binarySecret],
  ["console object", { consoleMessages: [{ args: [{ file: "synthetic-name.db" }] }] }, binarySecret],
  ["console plain array", { consoleMessages: [{ args: [Array.from(bytes)] }] }, binarySecret],
  ["console typed array", { consoleMessages: [{ args: [new Uint8Array(bytes)] }] }, binarySecret]
];

const scannerSurfaces: Record<string, string> = {
  URL: "root.url",
  "localStorage key": "root.localStorage[0][0]",
  "localStorage value": "root.localStorage[0][1]",
  "request text": "root.requests[0].text",
  "request raw embedded": "root.requests[0].body",
  "decimal plain array": "root",
  "direct ArrayBuffer": "root",
  "typed array offset": "root",
  "idb database name": "root.databases[0].name",
  "idb store name": "root.databases[0].stores[0].name",
  "idb index name": "root.databases[0].stores[0].indexes[0].name",
  "idb cursor key": "root.databases[0].stores[0].records[0].key",
  "idb cursor primaryKey": "root.databases[0].stores[0].records[0].primaryKey",
  "idb cursor value": "root.databases[0].stores[0].records[0].value",
  "cache name": "root.caches[0].name",
  "cache request URL": "root.caches[0].entries[0].request.url",
  "cache request method": "root.caches[0].entries[0].request.method",
  "cache request headers": "root.caches[0].entries[0].request.headers[0][1]",
  "cache request raw body": "root.caches[0].entries[0].request.body",
  "cache response headers": "root.caches[0].entries[0].response.headers[0][1]",
  "cache response raw body": "root.caches[0].entries[0].response.body",
  "console text": "root.consoleMessages[0].text",
  "console object": "root.consoleMessages[0].args[0].file",
  "console plain array": "root.consoleMessages[0].args[0]",
  "console typed array": "root.consoleMessages[0].args[0]"
};

for (const [name, value, secret] of scannerCases) {
  test(`privacy scanner catches ${name} without another carrier`, () => {
    expect(findPrivacyFindings(value, [secret])).toEqual([{
      surface: scannerSurfaces[name],
      secret: secret.name
    }]);
  });
}

test("privacy scanner catches a response status without another carrier", () => {
  const statusSecret: PrivacySecret = {
    name: "response status",
    bytes: new Uint8Array([43, 1, 0, 0]),
    forms: ["299"]
  };
  expect(findPrivacyFindings(
    { caches: [{ name: "safe", entries: [{ response: { status: 299 } }] }] },
    [statusSecret]
  )).toEqual([{
    surface: "root.caches[0].entries[0].response.status",
    secret: "response status"
  }]);
});

test("privacy scanner catches an Error message without another carrier", () => {
  const error = new Error("synthetic-name.db");
  error.stack = "safe-stack";
  expect(findPrivacyFindings(error, [binarySecret])).toEqual([{
    surface: "root.message",
    secret: "binary"
  }]);
});

test("privacy scanner catches a RegExp source without another carrier", () => {
  const secret: PrivacySecret = {
    name: "regular expression",
    bytes: new Uint8Array(),
    forms: ["private-pattern"]
  };
  expect(findPrivacyFindings(/private-pattern/, [secret])).toEqual([{
    surface: "root.source",
    secret: "regular expression"
  }]);
});

test("privacy scanner catches a bigint without another carrier", () => {
  const secret = createInt32PrivacySecret("bigint", SYNTHETIC_PRIVACY_SEED);
  expect(findPrivacyFindings(BigInt(SYNTHETIC_PRIVACY_SEED), [secret])).toEqual([{
    surface: "root",
    secret: "bigint"
  }]);
});

const integerSecrets = [
  { name: "seed", value: SYNTHETIC_PRIVACY_SEED },
  { name: "decoded sentinel", value: SYNTHETIC_DECODED_SENTINEL }
] as const;

function int32LittleEndian(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setInt32(0, value, true);
  return output;
}

for (const { name, value } of integerSecrets) {
  const raw = int32LittleEndian(value);
  const representations: Array<[string, unknown]> = [
    ["text", String(value)],
    ["UTF-8 bytes", Buffer.from(String(value), "utf8")],
    ["hex", Buffer.from(raw).toString("hex")],
    ["base64", Buffer.from(raw).toString("base64")],
    ["raw little-endian bytes", Buffer.from(raw)]
  ];
  for (const [representation, observation] of representations) {
    test(`${name} SecretSpec catches its ${representation} representation independently`, () => {
      const secrets = integerSecrets.map((entry) =>
        createInt32PrivacySecret(entry.name, entry.value)
      );
      expect(findPrivacyLeaks(observation, secrets)).toEqual([name]);
    });
  }
}

test("seed and decoded sentinel little-endian forms come from their fixture values", () => {
  expect(Buffer.from(int32LittleEndian(SYNTHETIC_PRIVACY_SEED)).toString("hex")).toBe("97060e00");
  expect(Buffer.from(int32LittleEndian(SYNTHETIC_DECODED_SENTINEL)).toString("hex")).toBe("db020000");
});

test("numeric sentinels require token boundaries in text and UTF-8 byte carriers", () => {
  const secret = createInt32PrivacySecret(
    "decoded sentinel",
    SYNTHETIC_DECODED_SENTINEL
  );
  const randomBlobUrl =
    "blob:http://127.0.0.1:4175/50a2bf28-3d9f-4731a-b720-12f356cd8bce";

  expect(findPrivacyLeaks(randomBlobUrl, [secret])).toEqual([]);
  expect(findPrivacyLeaks(Buffer.from(`prefix${SYNTHETIC_DECODED_SENTINEL}suffix`), [secret]))
    .toEqual([]);
  expect(findPrivacyLeaks(`?flags=${SYNTHETIC_DECODED_SENTINEL}&next=1`, [secret]))
    .toEqual(["decoded sentinel"]);
  expect(findPrivacyLeaks(Buffer.from(`flags=${SYNTHETIC_DECODED_SENTINEL}\n`), [secret]))
    .toEqual(["decoded sentinel"]);
});

const inspectionCases: Array<[string, unknown, string, string]> = [
  ["request", { requests: [{ inspectionError: "request.body" }] }, "root.requests[0]", "request.body"],
  ["console", { consoleMessages: [{ inspectionError: "console.arguments" }] }, "root.consoleMessages[0]", "console.arguments"],
  ["IndexedDB", { inspectionErrors: [{ inspectionError: "indexedDB.cursor", database: "private" }] }, "root.inspectionErrors[0]", "indexedDB.cursor"],
  ["Cache", { inspectionErrors: [{ inspectionError: "cache.response.body", cache: "private" }] }, "root.inspectionErrors[0]", "cache.response.body"]
];

for (const [name, value, surface, code] of inspectionCases) {
  test(`privacy scanner treats a ${name} inspection error as its own finding`, () => {
    const findings = findPrivacyFindings(value, [binarySecret]);
    expect(findings).toEqual([{
      surface,
      secret: `inspection:${code}`
    }]);
  });
}
