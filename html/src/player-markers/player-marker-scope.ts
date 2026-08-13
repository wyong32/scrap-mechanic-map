import type { TerrainCell, WorldMap } from "../domain/map-model";

export async function createPlayerMarkerScopeId(world: WorldMap): Promise<string> {
  if (world.source !== "save") {
    return "default";
  }

  const seed = world.seed ?? 0;
  const layout = {
    seed,
    cells: [...world.cells]
      .sort(compareCells)
      .map(({ x, y, uuid, xOffset, yOffset, rotation }) => ({
        x,
        y,
        uuid,
        xOffset,
        yOffset,
        rotation
      }))
  };
  const bytes = new TextEncoder().encode(JSON.stringify(layout));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hexDigest = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `save:${seed}:${hexDigest}`;
}

function compareCells(left: TerrainCell, right: TerrainCell): number {
  return left.y - right.y
    || left.x - right.x
    || left.uuid.localeCompare(right.uuid)
    || left.xOffset - right.xOffset
    || left.yOffset - right.yOffset
    || left.rotation - right.rotation;
}
