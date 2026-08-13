import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const productionRoots = [join(root, "src"), join(root, "public")];
const productionFiles = [join(root, "index.html")];
const textExtensions = new Set([".ts", ".json", ".html", ".svg"]);

function productionTextFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return productionTextFiles(path);
    if (!textExtensions.has(extname(path)) || path.endsWith(".test.ts")) return [];
    return [path];
  });
}

describe("English-only page content", () => {
  it("declares an English document and English page title", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Scrap Mechanic Map</title>");
  });

  it("contains no Chinese page copy or Chinese unicode escapes", () => {
    const offenders = [...productionFiles, ...productionRoots.flatMap(productionTextFiles)]
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return /[\u3400-\u9fff]/u.test(source)
          || /\\u(?:3[4-9a-f]|[4-9a-f][0-9a-f])[0-9a-f]{2}/iu.test(source);
      })
      .map((path) => relative(root, path));

    expect(offenders).toEqual([]);
  });
});
