import type { MapLocation, MapRepository, RegionDefinition, WorldMap } from "../domain/map-model";

export interface GeneratedEnvelope { schemaVersion: number; gameVersion: string; contentHash: string }
interface GeneratedRegion extends RegionDefinition { worldIds?: string[] }
interface RegionsBundle extends GeneratedEnvelope { displayNames: Record<string, string>; regions: GeneratedRegion[] }
interface LocationsBundle extends GeneratedEnvelope { locations: MapLocation[] }
interface ReferenceWorldBundle extends GeneratedEnvelope { world: WorldMap }
interface FixedWorldBundle extends GeneratedEnvelope { world: WorldMap }
export interface BuildInfoBundle extends GeneratedEnvelope { files: Array<{ name: string; contentHash: string; bytes: number }> }

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  return value;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function assertGeneratedSelfHash(bundle: GeneratedEnvelope, name: string): Promise<void> {
  if (bundle.schemaVersion !== 1) throw new Error(`Generated ${name} uses an unsupported schema. Run data:build for Scrap Mechanic 1.0.`);
  const { contentHash: _contentHash, ...withoutSelfHash } = bundle as GeneratedEnvelope & Record<string, unknown>;
  if (bundle.contentHash !== await sha256(JSON.stringify(canonicalize(withoutSelfHash)))) throw new Error(`Generated ${name} failed its integrity check. Run data:build again.`);
}

export async function parseVerifiedGeneratedBundle<T extends GeneratedEnvelope>(
  text: string,
  name: string,
  expected?: BuildInfoBundle
): Promise<T> {
  let bundle: T;
  try { bundle = JSON.parse(text) as T; } catch { throw new Error(`Generated ${name} is not valid JSON. Run data:build again.`); }
  await assertGeneratedSelfHash(bundle, name);
  if (expected) {
    if (bundle.gameVersion !== expected.gameVersion) throw new Error(`Generated ${name} has a mismatched game version. Run data:build again.`);
    const listed = expected.files.find((file) => file.name === name);
    if (!listed) throw new Error(`Generated ${name} is absent from build-info. Run data:build again.`);
    if (listed.contentHash !== bundle.contentHash) throw new Error(`Generated ${name} does not match build-info. Run data:build again.`);
    const portableText = text.replace(/\r\n/g, "\n");
    if (listed.bytes !== new TextEncoder().encode(portableText).byteLength) throw new Error(`Generated ${name} byte size does not match build-info. Run data:build again.`);
  }
  return bundle;
}

/** Reads and validates only public generated data; game roots and saves are never fetched. */
export class ReferenceMapRepository implements MapRepository {
  private buildInfo?: Promise<BuildInfoBundle>;
  private regionsBundle?: Promise<RegionsBundle>;
  private locationsBundle?: Promise<LocationsBundle>;

  constructor(private readonly basePath = "/data/generated") {}

  private cached<T>(key: "buildInfo" | "regionsBundle" | "locationsBundle", loader: () => Promise<T>): Promise<T> {
    const current = this[key] as Promise<T> | undefined;
    if (current) return current;
    const pending = loader().catch((error: unknown) => { this[key] = undefined as never; throw error; });
    this[key] = pending as never;
    return pending;
  }

  private async fetchBundle<T extends GeneratedEnvelope>(name: string, expected?: BuildInfoBundle): Promise<T> {
    const response = await fetch(`${this.basePath}/${name}`);
    if (!response.ok) throw new Error(`Unable to load generated map data '${name}'. Rebuild the local data bundle and try again.`);
    const text = await response.text();
    return parseVerifiedGeneratedBundle<T>(text, name, expected);
  }

  private ensureBuildInfo(): Promise<BuildInfoBundle> {
    return this.cached("buildInfo", () => this.fetchBundle<BuildInfoBundle>("build-info.json"));
  }
  private loadRegionsBundle(): Promise<RegionsBundle> {
    return this.cached("regionsBundle", async () => this.fetchBundle<RegionsBundle>("regions.json", await this.ensureBuildInfo()));
  }
  private loadLocationsBundle(): Promise<LocationsBundle> {
    return this.cached("locationsBundle", async () => this.fetchBundle<LocationsBundle>("locations.json", await this.ensureBuildInfo()));
  }

  async loadRegions(): Promise<RegionDefinition[]> {
    const bundle = await this.loadRegionsBundle();
    return bundle.regions.map(({ worldIds: _worldIds, ...region }) => ({ ...region, name: bundle.displayNames[region.id] ?? region.name }));
  }
  async loadLocations(): Promise<MapLocation[]> { return (await this.loadLocationsBundle()).locations; }

  async loadWorld(regionId: string): Promise<WorldMap> {
    try {
      const [regions, locations, buildInfo] = await Promise.all([this.loadRegionsBundle(), this.loadLocations(), this.ensureBuildInfo()]);
      const region = regions.regions.find((candidate) => candidate.id === regionId);
      if (!region) throw new Error(`Unknown supported region '${regionId}'`);
      const regionLocations = locations.filter((location) => location.regionId === regionId);
      if (region.id === "surface") return { ...(await this.fetchBundle<ReferenceWorldBundle>("reference-world.json", buildInfo)).world, locations: regionLocations };
      const worldId = region.worldIds?.[0];
      if (!worldId) throw new Error(`Region '${regionId}' has no fixed-world mapping. Run data:build with a complete 1.0 installation.`);
      return { ...(await this.fetchBundle<FixedWorldBundle>(`worlds/${worldId}.json`, buildInfo)).world, locations: regionLocations };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown data loading error";
      throw new Error(`Could not open '${regionId}'. The current map remains available; rebuild map data or choose another region. ${message}`);
    }
  }
}

export const referenceMapRepository = new ReferenceMapRepository();
