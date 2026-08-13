import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const configPath = resolve(process.cwd(), "vercel.json");

describe("Vercel static deployment", () => {
  it("deploys only the lightweight default Vite output", async () => {
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      $schema?: string;
      framework?: string;
      buildCommand?: string;
      outputDirectory?: string;
      headers?: Array<{
        source?: string;
        headers?: Array<{ key?: string; value?: string }>;
      }>;
    };

    expect(config.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    expect(config.framework).toBe("vite");
    expect(config.buildCommand).toBe("npm run release:check");
    expect(config.outputDirectory).toBe("dist");
    expect(config.headers).toBeUndefined();
  });
});
