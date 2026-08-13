import type { ExtractionCandidate } from "./candidate-extractor.ts";

export interface CandidateSelectionThresholds {
  normalizedWidth: number;
  normalizedHeight: number;
  interiorInset: number;
  edgeStripWidth: number;
  maximumInteriorDistance: number;
  maximumEdgeDistance: number;
  minimumClusterSize: number;
  maximumGroupSize: number;
  targetRotation?: 0 | 1 | 2 | 3;
}

export interface CandidatePairScore {
  left: ExtractionCandidate;
  right: ExtractionCandidate;
  interiorDistance: number;
  edgeDistances: { top: number; right: number; bottom: number; left: number };
  consistent: boolean;
}

export interface CandidateRejection {
  candidate: ExtractionCandidate;
  reasons: string[];
}

export interface SelectedCandidateImage {
  width: number;
  height: number;
  channels: 3;
  rotation: 0 | 1 | 2 | 3;
  synthesized: boolean;
  pixels: Uint8Array;
}

export interface CandidateDecision {
  status: "accepted" | "rejected";
  selected?: ExtractionCandidate;
  cluster: ExtractionCandidate[];
  scores: CandidatePairScore[];
  rejections: CandidateRejection[];
  reasons: string[];
  image?: SelectedCandidateImage;
}

interface NormalizedCandidate {
  candidate: ExtractionCandidate;
  pixels: Uint8Array;
}

function validateThresholds(thresholds: CandidateSelectionThresholds): void {
  const integers = [
    thresholds.normalizedWidth,
    thresholds.normalizedHeight,
    thresholds.interiorInset,
    thresholds.edgeStripWidth,
    thresholds.minimumClusterSize,
    thresholds.maximumGroupSize,
  ];
  if (!integers.every(Number.isSafeInteger)
    || thresholds.normalizedWidth <= 0 || thresholds.normalizedHeight <= 0
    || thresholds.interiorInset < 0 || thresholds.edgeStripWidth <= 0
    || thresholds.interiorInset * 2 >= thresholds.normalizedWidth
    || thresholds.interiorInset * 2 >= thresholds.normalizedHeight
    || thresholds.edgeStripWidth * 2 > thresholds.normalizedWidth
    || thresholds.edgeStripWidth * 2 > thresholds.normalizedHeight
    || thresholds.minimumClusterSize <= 0
    || thresholds.maximumGroupSize <= 0
    || ![thresholds.maximumInteriorDistance, thresholds.maximumEdgeDistance]
      .every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error("Candidate selection thresholds are invalid.");
  }
}

function compareCandidate(left: ExtractionCandidate, right: ExtractionCandidate): number {
  return left.world.x - right.world.x || left.world.y - right.world.y
    || left.sha256.localeCompare(right.sha256);
}

function validateGroup(candidates: readonly ExtractionCandidate[]): void {
  if (candidates.length === 0) throw new Error("Candidate group must not be empty.");
  const { uuid, rotation } = candidates[0]!;
  const { offset, footprint } = candidates[0]!;
  if (candidates.some((candidate) => candidate.uuid !== uuid || candidate.rotation !== rotation
    || candidate.offset.x !== offset.x || candidate.offset.y !== offset.y
    || candidate.footprint.width !== footprint.width || candidate.footprint.height !== footprint.height
    || candidate.channels !== 3
    || candidate.width <= 0 || candidate.height <= 0
    || candidate.pixels.length !== candidate.width * candidate.height * 3)) {
    throw new Error("Candidate group is invalid or mixes UUID/rotation/offset/footprint keys.");
  }
}

function normalize(candidate: ExtractionCandidate, width: number, height: number): NormalizedCandidate {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(candidate.height - 1, Math.floor(y * candidate.height / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(candidate.width - 1, Math.floor(x * candidate.width / width));
      const source = (sourceY * candidate.width + sourceX) * 3;
      const target = (y * width + x) * 3;
      pixels[target] = candidate.pixels[source]!;
      pixels[target + 1] = candidate.pixels[source + 1]!;
      pixels[target + 2] = candidate.pixels[source + 2]!;
    }
  }
  return { candidate, pixels };
}

function perceptualDifference(left: Uint8Array, right: Uint8Array, offset: number): number {
  const red = Math.abs(left[offset]! - right[offset]!);
  const green = Math.abs(left[offset + 1]! - right[offset + 1]!);
  const blue = Math.abs(left[offset + 2]! - right[offset + 2]!);
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

function regionDistance(
  left: Uint8Array,
  right: Uint8Array,
  width: number,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      sum += perceptualDifference(left, right, (y * width + x) * 3);
      count += 1;
    }
  }
  return sum / count;
}

function scorePair(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  thresholds: CandidateSelectionThresholds,
): CandidatePairScore {
  const width = thresholds.normalizedWidth;
  const height = thresholds.normalizedHeight;
  const inset = thresholds.interiorInset;
  const strip = thresholds.edgeStripWidth;
  const interiorDistance = regionDistance(left.pixels, right.pixels, width, inset, width - inset, inset, height - inset);
  const edgeDistances = {
    top: regionDistance(left.pixels, right.pixels, width, 0, width, 0, strip),
    right: regionDistance(left.pixels, right.pixels, width, width - strip, width, 0, height),
    bottom: regionDistance(left.pixels, right.pixels, width, 0, width, height - strip, height),
    left: regionDistance(left.pixels, right.pixels, width, 0, strip, 0, height),
  };
  return {
    left: left.candidate,
    right: right.candidate,
    interiorDistance,
    edgeDistances,
    consistent: interiorDistance <= thresholds.maximumInteriorDistance
      && Object.values(edgeDistances).every((distance) => distance <= thresholds.maximumEdgeDistance),
  };
}

function maximumMutuallyConsistentSubset(
  candidates: readonly ExtractionCandidate[],
  scores: readonly CandidatePairScore[],
): ExtractionCandidate[] {
  const index = new Map(candidates.map((candidate, candidateIndex) => [candidate, candidateIndex]));
  const adjacency = candidates.map(() => new Set<number>());
  for (const score of scores) {
    if (!score.consistent) continue;
    const left = index.get(score.left)!;
    const right = index.get(score.right)!;
    adjacency[left]!.add(right);
    adjacency[right]!.add(left);
  }
  let best: number[] = [];
  const preferred = (candidate: readonly number[], current: readonly number[]) => {
    if (candidate.length !== current.length) return candidate.length > current.length;
    for (let offset = 0; offset < candidate.length; offset += 1) {
      if (candidate[offset] !== current[offset]) return candidate[offset]! < current[offset]!;
    }
    return false;
  };
  const update = (clique: readonly number[]) => {
    const sorted = [...clique].sort((left, right) => left - right);
    if (preferred(sorted, best)) best = sorted;
  };
  const colorSort = (vertices: readonly number[]) => {
    const remaining = [...vertices];
    const ordered: number[] = [];
    const bounds: number[] = [];
    let color = 0;
    while (remaining.length > 0) {
      color += 1;
      const colorClass: number[] = [];
      for (const vertex of [...remaining]) {
        if (colorClass.every((member) => !adjacency[vertex]!.has(member))) {
          colorClass.push(vertex);
          remaining.splice(remaining.indexOf(vertex), 1);
          ordered.push(vertex);
          bounds.push(color);
        }
      }
    }
    return { ordered, bounds };
  };
  const expand = (clique: number[], vertices: number[]): void => {
    const { ordered, bounds } = colorSort(vertices);
    for (let offset = ordered.length - 1; offset >= 0; offset -= 1) {
      if (clique.length + bounds[offset]! < best.length) return;
      const vertex = ordered[offset]!;
      clique.push(vertex);
      const next = vertices.filter((candidate) => adjacency[vertex]!.has(candidate));
      if (next.length > 0) expand(clique, next);
      else update(clique);
      clique.pop();
      vertices = vertices.filter((candidate) => candidate !== vertex);
    }
  };
  expand([], candidates.map((_candidate, candidateIndex) => candidateIndex));
  return best.map((candidateIndex) => candidates[candidateIndex]!);
}

function rejectionReasons(
  candidate: ExtractionCandidate,
  scores: readonly CandidatePairScore[],
  thresholds: CandidateSelectionThresholds,
): string[] {
  const candidateScores = scores.filter((score) => score.left === candidate || score.right === candidate);
  const reasons = ["outside-largest-consistent-cluster"];
  if (candidateScores.some((score) => score.interiorDistance > thresholds.maximumInteriorDistance)) {
    reasons.push("excessive-interior-distance");
  }
  if (candidateScores.some((score) => Object.values(score.edgeDistances)
    .some((distance) => distance > thresholds.maximumEdgeDistance))) {
    reasons.push("excessive-edge-distance");
  }
  return reasons;
}

function medoid(cluster: readonly ExtractionCandidate[], scores: readonly CandidatePairScore[]): ExtractionCandidate {
  const totalDistance = (candidate: ExtractionCandidate) => scores
    .filter((score) => cluster.includes(score.left) && cluster.includes(score.right)
      && (score.left === candidate || score.right === candidate))
    .reduce((total, score) => total + score.interiorDistance + Object.values(score.edgeDistances)
      .reduce((edgeTotal, distance) => edgeTotal + distance, 0), 0);
  return [...cluster].sort((left, right) => totalDistance(left) - totalDistance(right) || compareCandidate(left, right))[0]!;
}

function rotateClockwise(image: SelectedCandidateImage): SelectedCandidateImage {
  const output = new Uint8Array(image.pixels.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 3;
      const targetX = image.height - y - 1;
      const targetY = x;
      const target = (targetY * image.height + targetX) * 3;
      output.set(image.pixels.subarray(source, source + 3), target);
    }
  }
  return { ...image, width: image.height, height: image.width, pixels: output };
}

function selectedImage(candidate: ExtractionCandidate, targetRotation: 0 | 1 | 2 | 3): SelectedCandidateImage {
  const turns = (targetRotation - candidate.rotation + 4) % 4;
  if (turns !== 0 && candidate.width !== candidate.height) {
    throw new Error("Quarter-turn synthesis requires an exactly square crop.");
  }
  let image: SelectedCandidateImage = {
    width: candidate.width,
    height: candidate.height,
    channels: 3,
    rotation: targetRotation,
    synthesized: turns !== 0,
    pixels: new Uint8Array(candidate.pixels),
  };
  for (let turn = 0; turn < turns; turn += 1) image = rotateClockwise(image);
  return image;
}

export function selectCandidateGroup(
  candidates: readonly ExtractionCandidate[],
  thresholds: CandidateSelectionThresholds,
): CandidateDecision {
  validateThresholds(thresholds);
  validateGroup(candidates);
  if (candidates.length > thresholds.maximumGroupSize) {
    throw new Error("Candidate group exceeds the caller-supplied exact-search bound.");
  }
  const sorted = [...candidates].sort(compareCandidate);
  const normalized = sorted.map((candidate) => normalize(
    candidate,
    thresholds.normalizedWidth,
    thresholds.normalizedHeight,
  ));
  const scores: CandidatePairScore[] = [];
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      scores.push(scorePair(normalized[left]!, normalized[right]!, thresholds));
    }
  }
  const cluster = maximumMutuallyConsistentSubset(sorted, scores);
  const rejections = sorted
    .filter((candidate) => !cluster.includes(candidate))
    .map((candidate) => ({ candidate, reasons: rejectionReasons(candidate, scores, thresholds) }));
  if (cluster.length < thresholds.minimumClusterSize) {
    const rejected = new Set(rejections.map(({ candidate }) => candidate));
    for (const candidate of cluster) {
      if (!rejected.has(candidate)) {
        const reasons = rejectionReasons(candidate, scores, thresholds)
          .filter((reason) => reason !== "outside-largest-consistent-cluster");
        rejections.push({ candidate, reasons: ["insufficient-consistent-candidates", ...reasons] });
      }
    }
    return {
      status: "rejected",
      cluster,
      scores,
      rejections: rejections.sort((left, right) => compareCandidate(left.candidate, right.candidate)),
      reasons: ["insufficient-consistent-candidates"],
    };
  }
  const selected = medoid(cluster, scores);
  const targetRotation = thresholds.targetRotation ?? selected.rotation;
  return {
    status: "accepted",
    selected,
    cluster,
    scores,
    rejections,
    reasons: [],
    image: selectedImage(selected, targetRotation),
  };
}
