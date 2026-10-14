export type Readiness = "early" | "ready";

export interface ReachRate {
  target: number;
  hits: number;
  hitRate: number;
}

export interface ReadyPrediction {
  status: "ready";
  readiness: Readiness;
  predicted: number;
  low: number;
  high: number;
  similarCount: number;
  confidence: "low" | "medium" | "high";
  window: number;
  pattern: string;
  leadIn: number[];
  reached: ReachRate[];
}

export interface NeedData {
  status: "need-data";
  message: string;
}

export type Prediction = ReadyPrediction | NeedData;

export interface PredictInput {
  crashes: number[];
}

const WINDOWS = [3, 2, 1] as const;

const REACH_TARGETS = [1.2, 1.5, 2, 3, 5, 10];

const MIN_SIMILAR = 8;

const HISTORY_HEADER = ["# Crycodi crash history", "# Oldest first, newest last."];

export function parseCrashPoints(raw: string): number[] {
  const chunks = raw.split(/[\s;|]+/).filter(Boolean);
  const tokens: string[] = [];

  for (const chunk of chunks) {
    const cleaned = chunk.trim();
    if (cleaned.startsWith("#")) continue;
    if (/^\d+,\d+$/.test(cleaned)) {
      tokens.push(cleaned.replace(",", "."));
      continue;
    }
    for (const part of cleaned.split(",")) {
      const token = part.trim();
      if (token && !token.startsWith("#")) tokens.push(token);
    }
  }

  return tokens
    .map((token) => token.replace(/x$/i, "").replace(/[^\d.]/g, ""))
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 1_000_000);
}

export function appendLivePoints(current: number[], incoming: number[]): number[] {
  const next = incoming.filter((value) => Number.isFinite(value) && value >= 1);
  if (next.length === 0) return current;
  if (current.length === 0) return [...next];

  const max = Math.min(current.length, next.length);
  for (let overlap = max; overlap >= 0; overlap -= 1) {
    const tail = current.slice(current.length - overlap);
    const head = next.slice(0, overlap);
    const matches = tail.every((value, index) => Math.abs(value - head[index]) < 0.001);
    if (matches) return [...current, ...next.slice(overlap)];
  }

  return [...current, next[next.length - 1]];
}

export function formatHistory(points: number[]): string {
  const lines = points.map((value) => value.toFixed(2));
  return [...HISTORY_HEADER, ...lines].join("\n") + "\n";
}

export function sampleCrashes(count = 80): number[] {
  let state = 20261014;
  const crashes: number[] = [];

  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const unit = (state + 0.5) / 4294967296;
    const raw = Math.floor((100 * 0.99) / unit) / 100;
    crashes.push(Math.max(1, raw));
  }

  return crashes;
}

export function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}x`;
}

export function predict(input: PredictInput): Prediction {
  const crashes = input.crashes.filter((value) => Number.isFinite(value) && value >= 1);

  if (crashes.length < 4) {
    return {
      status: "need-data",
      message: "Add at least 4 crash points. The newest point should be last.",
    };
  }

  const match = matchContext(crashes);
  if (!match || match.nexts.length === 0) {
    return {
      status: "need-data",
      message: "Add another crash point so a lead-in has a following round.",
    };
  }

  const sorted = [...match.nexts].sort((a, b) => a - b);

  return {
    status: "ready",
    readiness: match.nexts.length >= MIN_SIMILAR ? "ready" : "early",
    predicted: quantile(sorted, 0.5),
    low: quantile(sorted, 0.25),
    high: quantile(sorted, 0.75),
    similarCount: match.nexts.length,
    confidence: confidenceFor(match.nexts.length, match.window),
    window: match.window,
    pattern: match.key,
    leadIn: crashes.slice(-match.window),
    reached: reachRates(crashes),
  };
}

function confidenceFor(similarCount: number, window: number): "low" | "medium" | "high" {
  if (similarCount >= 24 && window >= 2) return "high";
  if (similarCount >= MIN_SIMILAR) return "medium";
  return "low";
}

function bucket(value: number): "L" | "M" | "H" {
  if (value < 2) return "L";
  if (value < 5) return "M";
  return "H";
}

function contextKey(crashes: number[], endExclusive: number, window: number): string {
  return crashes
    .slice(endExclusive - window, endExclusive)
    .map(bucket)
    .join("");
}

function matchContext(crashes: number[]): { window: number; key: string; nexts: number[] } | null {
  let fallback: { window: number; key: string; nexts: number[] } | null = null;

  for (const window of WINDOWS) {
    if (crashes.length <= window) continue;
    const key = contextKey(crashes, crashes.length, window);
    const nexts: number[] = [];

    for (let index = window; index < crashes.length; index += 1) {
      if (contextKey(crashes, index, window) === key) nexts.push(crashes[index]);
    }

    const candidate = { window, key, nexts };
    if (nexts.length >= MIN_SIMILAR) return candidate;
    if (!fallback || nexts.length > fallback.nexts.length) fallback = candidate;
  }

  return fallback;
}

function reachRates(values: number[]): ReachRate[] {
  return REACH_TARGETS.map((target) => {
    const hits = values.filter((value) => value + 1e-9 >= target).length;
    return {
      target,
      hits,
      hitRate: values.length === 0 ? 0 : hits / values.length,
    };
  });
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  const weight = position - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

export function patternPhrase(pattern: string): string {
  const names: Record<string, string> = {
    L: "under 2x",
    M: "2x to 5x",
    H: "5x or more",
  };
  return pattern
    .split("")
    .map((mark) => names[mark] ?? mark)
    .join(", then ");
}
