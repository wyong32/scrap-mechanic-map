export interface TileHeader { uuid: string; width: number; height: number; version: number }

/**
 * Reads the documented-in-practice, fixed portion of the binary `.tile` header.
 * This reader deliberately stops before payload sections and never mutates tiles.
 */
export function readTileHeader(bytes: Uint8Array, source = "<tile>"): TileHeader {
  if (bytes.byteLength < 40) throw new Error(`${source}: tile header is truncated`);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "TILE") throw new Error(`${source}: expected TILE magic`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version < 1 || version > 15) throw new Error(`${source}: unsupported tile version ${version}; supported versions are 1..15`);
  const hex = [...bytes.subarray(8, 24)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const width = view.getUint32(32, true);
  const height = view.getUint32(36, true);
  if (width < 1 || width > 32 || height < 1 || height > 32) throw new Error(`${source}: invalid tile dimensions ${width}x${height}`);
  return { uuid, width, height, version };
}
