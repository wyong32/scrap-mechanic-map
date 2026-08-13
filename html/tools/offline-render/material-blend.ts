export type Rgb = readonly [number, number, number];

export function decodeGroundWeights(packed: bigint): number[] {
  const weights = Array.from({ length: 8 }, (_, index) =>
    Number((packed >> BigInt(index * 8)) & 0xffn)
  );
  const paintedTotal = weights.reduce((sum, weight) => sum + weight, 0);
  weights.push(Math.max(0, 255 - paintedTotal));
  return weights;
}

export function blendMaterialPixel(
  packed: bigint,
  materials: readonly Rgb[]
): [number, number, number] {
  if (materials.length !== 9) {
    throw new Error(`Expected nine ground material colors, received ${materials.length}.`);
  }

  const weights = decodeGroundWeights(packed);
  const total = Math.max(255, weights.reduce((sum, weight) => sum + weight, 0));
  const channels = [0, 0, 0];
  for (let materialIndex = 0; materialIndex < weights.length; materialIndex += 1) {
    const weight = weights[materialIndex];
    for (let channel = 0; channel < channels.length; channel += 1) {
      channels[channel] += materials[materialIndex][channel] * weight;
    }
  }
  return channels.map((channel) => Math.round(channel / total)) as [number, number, number];
}
