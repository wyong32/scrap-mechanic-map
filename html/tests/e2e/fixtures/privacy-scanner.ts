export interface PrivacySecret {
  name: string;
  bytes: Uint8Array;
  byteForms?: Uint8Array[];
  forms: string[];
  boundaryForms?: string[];
}
export interface PrivacyFinding { surface: string; secret: string; }

export function createPrivacySecret(
  name: string,
  rawBytes: Uint8Array,
  textForms: string[]
): PrivacySecret {
  const raw = Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  const forms = [...new Set([
    ...textForms,
    raw.toString("hex"),
    raw.toString("base64"),
    raw.toString("utf8")
  ].filter((form) => form.length > 0))];
  return {
    name,
    bytes: Uint8Array.from(raw),
    byteForms: forms.map((form) => Uint8Array.from(Buffer.from(form, "utf8"))),
    forms
  };
}

export function createInt32PrivacySecret(name: string, value: number): PrivacySecret {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return {
    ...createPrivacySecret(name, bytes, [String(value)]),
    boundaryForms: [String(value)]
  };
}

function containsBoundaryForm(text: string, form: string): boolean {
  let index = text.indexOf(form);
  while (index >= 0) {
    const before = index === 0 ? "" : text[index - 1]!;
    const afterIndex = index + form.length;
    const after = afterIndex === text.length ? "" : text[afterIndex]!;
    if (
      !/[A-Za-z0-9_]/.test(before) &&
      !/[A-Za-z0-9_]/.test(after)
    ) {
      return true;
    }
    index = text.indexOf(form, index + 1);
  }
  return false;
}

export function findPrivacyFindings(value: unknown, secrets: PrivacySecret[], surface = "root"): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const report = (secret: PrivacySecret, path: string) => findings.push({ surface: path, secret: secret.name });
  const scanBytes = (bytes: Uint8Array, path: string) => secrets.forEach((secret) => {
    const boundaryForms = new Set(secret.boundaryForms ?? []);
    const byteForms = (secret.byteForms ?? []).filter(
      (needle) =>
        !secret.forms.some(
          (form) =>
            boundaryForms.has(form) &&
            Buffer.from(needle).equals(Buffer.from(form, "utf8"))
        )
    );
    const hasOpaqueMatch = [secret.bytes, ...byteForms].some(
      (needle) =>
        needle.byteLength > 0 &&
        Buffer.from(bytes).includes(Buffer.from(needle))
    );
    const hasBoundaryMatch = [...boundaryForms].some((form) =>
      containsBoundaryForm(Buffer.from(bytes).toString("latin1"), form)
    );
    if (hasOpaqueMatch || hasBoundaryMatch) {
      report(secret, path);
    }
  });
  const scanText = (text: string, path: string) => secrets.forEach((secret) => {
    const boundaryForms = new Set(secret.boundaryForms ?? []);
    if (
      secret.forms.some(
        (form) =>
          form.length > 0 &&
          (boundaryForms.has(form)
            ? containsBoundaryForm(text, form)
            : text.includes(form))
      )
    ) {
      report(secret, path);
    }
  });
  const scan = (current: unknown, path: string): void => {
    if (current && typeof current === "object" && "inspectionError" in current) { findings.push({ surface: path, secret: `inspection:${String((current as { inspectionError: unknown }).inspectionError)}` }); return; }
    if (current instanceof ArrayBuffer) { scanBytes(new Uint8Array(current), path); return; }
    if (ArrayBuffer.isView(current)) { scanBytes(new Uint8Array(current.buffer, current.byteOffset, current.byteLength), path); return; }
    if (typeof current === "string") { scanText(current, path); return; }
    if (typeof current === "number" && Number.isFinite(current)) { scanText(String(current), path); return; }
    if (typeof current === "bigint") { scanText(String(current), path); return; }
    if (current instanceof Error) {
      scanText(current.name, `${path}.name`);
      scanText(current.message, `${path}.message`);
      if (current.stack) scanText(current.stack, `${path}.stack`);
      if ("cause" in current) scan(current.cause, `${path}.cause`);
      return;
    }
    if (current instanceof RegExp) {
      scanText(current.source, `${path}.source`);
      scanText(current.flags, `${path}.flags`);
      return;
    }
    if (Array.isArray(current)) {
      if (current.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) scanBytes(Uint8Array.from(current as number[]), path);
      current.forEach((entry, index) => scan(entry, `${path}[${index}]`)); return;
    }
    if (current && typeof current === "object") Object.entries(current).forEach(([key, entry]) => { scanText(key, `${path}.${key}`); scan(entry, `${path}.${key}`); });
  };
  scan(value, surface); return findings;
}

export function findPrivacyLeaks(value: unknown, secrets: PrivacySecret[]): string[] {
  return [...new Set(findPrivacyFindings(value, secrets).map((finding) => finding.secret))];
}
