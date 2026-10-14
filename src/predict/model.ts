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
  salt: number;
  model: ModelId;
  models: ModelForecast[];
  summary: string;
  reached: ReachRate[];
}

export interface NeedData {
  status: "need-data";
  message: string;
}

export type Prediction = ReadyPrediction | NeedData;

export type ModelId =
  | "similar"
  | "nearest"
  | "repeat"
  | "recent"
  | "history"
  | "after"
  | "band"
  | "last"
  | "average"
  | "spike";

const MODEL_IDS: ModelId[] = [
  "similar",
  "nearest",
  "repeat",
  "recent",
  "history",
  "after",
  "band",
  "last",
  "average",
  "spike",
];

export interface ModelForecast {
  id: ModelId;
  name: string;
  detail: string;
  predicted: number;
  low: number;
  high: number;
  summary: string;
}

export interface PredictInput {
  crashes: number[];
  salt?: number;
  model?: ModelId;
}

export const DEFAULT_SALT = 0.3;

const SALT_SHARPNESS = 2;

export const CALIBRATED_HISTORY = [
  1.87, 1.94, 1, 2.09, 1.07, 1, 1.35, 1, 4.17, 1.74, 2.08, 1.09, 1, 26.29, 1, 1.11, 1.61, 1.06, 1.84,
  3.31, 2.07, 4.4, 53.95, 1, 1, 1, 1.67, 1.85, 1.15, 6.23, 1, 2.44, 1, 2.13, 1.1, 1, 12.57, 1.11, 5.98,
  5.56, 1, 1.23, 6.23, 8.99, 1, 1.41, 5.96, 25.55, 52.57, 6.81, 1, 1, 1, 1.12, 2.77, 1, 1, 1, 1.1, 1.08,
  1.12, 1.12, 58.94, 58.94, 1, 1, 1.1, 1.08, 1.12, 1.12, 58.94, 1.44, 1.84, 7.8, 10.22, 1, 1, 5.01, 1.47,
  1, 1.06, 1.17, 8.34, 1.47, 1.15, 3.71, 1.16, 15.7, 2.41, 6.62, 3.03, 1.49, 2.43, 3.29, 1, 9.79, 10.78,
  4.37, 2.2, 1, 6.42, 5.94, 34.26, 1, 1.05, 2.29, 2.48, 6.93, 4.2, 1.07, 1, 1, 4.35, 55.32, 1.16, 22.86,
  1.4, 1.89, 1.14, 1, 1.9, 28.28, 39.32, 2.66, 1, 1.22, 1.92, 3, 8.02, 2.38, 1, 69, 3.89, 1, 1, 1.05, 1,
  16.49, 64.54, 2.95, 1, 1, 1.23, 10.23, 1.82, 1.17, 2.93, 3.61, 18, 1, 1.61, 1, 1.6, 12.83, 1, 2.05, 2.57,
  1.11, 2.03, 1, 1.32, 1.78, 1.52, 3.26, 1, 1.17, 1, 1.68, 1, 1, 98.21, 1.48, 1.23, 1.53, 11.38, 12.8,
  2.09, 1.34, 2.4, 1.18, 2.41, 1.04, 1.78, 1, 1.49, 1.43, 1, 1.34, 2.13, 1.01, 1.49, 1.43, 1, 1.34, 2.13,
  2.13, 1.01, 1.49, 1.43, 1, 1.34, 2.13, 1.01, 1.21, 7.24, 1.79, 1.11, 1.03, 2.63, 3.79,
  1.18, 5.41, 1, 1, 6.13, 1.46, 1, 56.36, 4.9, 2.89, 3.52, 12.92, 1, 1, 22.8, 1, 1.02, 1.19, 1, 9, 53.23,
  2.33, 1.62, 1.89, 1.44, 1.94, 76.04, 1.06, 93.38, 5.49,
];

const LEAD_WINDOW = 5;

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
  const salt = input.salt != null && input.salt > 0 ? input.salt : DEFAULT_SALT;
  const model = input.model ?? "similar";

  if (crashes.length < 4) {
    return {
      status: "need-data",
      message: "Add at least 4 crash points. The newest point should be last.",
    };
  }

  const window = Math.min(LEAD_WINDOW, crashes.length - 1);
  const similar = similarRounds(crashes, salt, window);
  if (similar.length === 0) {
    return {
      status: "need-data",
      message: "Add another crash point so a lead-in has a following round.",
    };
  }

  const models = buildForecasts(crashes, similar);
  const selected = models.find((item) => item.id === model) ?? models[0];
  const withinSalt = similar.filter((round) => round.distance <= salt).length;

  return {
    status: "ready",
    readiness: withinSalt >= MIN_SIMILAR ? "ready" : "early",
    predicted: selected.predicted,
    low: selected.low,
    high: selected.high,
    similarCount: similar.length,
    confidence: confidenceFor(withinSalt, window),
    window,
    pattern: crashes.slice(-window).map(bucket).join(""),
    leadIn: crashes.slice(-window),
    salt,
    model: selected.id,
    models,
    summary: selected.summary,
    reached: reachRates(crashes),
  };
}

const SALT_CANDIDATES = [0.2, 0.25, 0.3, 0.35, 0.45, 0.55, 0.7, 0.85, 1, 1.2];

export interface StudyResult {
  salt: number;
  error: number;
  predicted: number;
  low: number;
  high: number;
  count: number;
  model: ModelId;
}

export function studyModel(crashes: number[]): StudyResult | null {
  const clean = crashes.filter((value) => Number.isFinite(value) && value >= 1);
  if (clean.length < 8) return null;

  let bestSalt = DEFAULT_SALT;
  let bestError = Number.POSITIVE_INFINITY;
  for (const salt of SALT_CANDIDATES) {
    const error = scoreSalt(clean, salt);
    const nearer = Math.abs(salt - DEFAULT_SALT) < Math.abs(bestSalt - DEFAULT_SALT);
    if (error < bestError - 1e-9 || (Math.abs(error - bestError) <= 1e-9 && nearer)) {
      bestSalt = salt;
      bestError = error;
    }
  }

  let bestModel: ModelId = "similar";
  for (const model of MODEL_IDS) {
    const error = model === "similar" ? bestError : scoreModel(clean, bestSalt, model);
    if (error < bestError - 1e-9) {
      bestModel = model;
      bestError = error;
    }
  }

  const prediction = predict({ crashes: clean, salt: bestSalt, model: bestModel });
  if (prediction.status !== "ready") return null;
  return {
    salt: bestSalt,
    error: bestError,
    predicted: prediction.predicted,
    low: prediction.low,
    high: prediction.high,
    count: clean.length,
    model: bestModel,
  };
}

export function scoreSalt(crashes: number[], salt: number): number {
  return scoreModel(crashes, salt, "similar");
}

function scoreModel(crashes: number[], salt: number, model: ModelId): number {
  if (crashes.length < 8) return Number.POSITIVE_INFINITY;
  let error = 0;
  let count = 0;
  for (let index = 6; index < crashes.length; index += 1) {
    const result = predict({ crashes: crashes.slice(0, index), salt, model });
    if (result.status !== "ready") continue;
    error += Math.abs(Math.log(result.predicted) - Math.log(crashes[index]));
    count += 1;
  }
  return count === 0 ? Number.POSITIVE_INFINITY : error / count;
}

function buildForecasts(
  crashes: number[],
  similar: Array<{ value: number; distance: number; weight: number }>,
): ModelForecast[] {
  const similarLow = roundMultiplier(weightedQuantile(similar, 0.25));
  const similarMid = roundMultiplier(weightedQuantile(similar, 0.5));
  const similarHigh = roundMultiplier(weightedQuantile(similar, 0.75));
  const nearestValues = similar.slice(0, Math.min(3, similar.length)).map((round) => round.value);
  const recent = crashes.slice(-20);
  const repeated = repeatValues(crashes);

  return [
    forecast(
      "similar",
      "Similar lead-in",
      "5-round matches",
      similarMid,
      similarLow,
      similarHigh,
      `Similar lead-ins were followed by a middle crash of ${formatMultiplier(similarMid)}, between ${formatMultiplier(similarLow)} and ${formatMultiplier(similarHigh)}.`,
    ),
    forecast(
      "nearest",
      "Nearest lead-in",
      "Closest past match",
      roundMultiplier(similar[0].value),
      roundMultiplier(Math.min(...nearestValues)),
      roundMultiplier(Math.max(...nearestValues)),
      `The closest lead-in was followed by ${formatMultiplier(similar[0].value)}.`,
    ),
    forecast(
      "repeat",
      "Repeated stretch",
      repeated.detail,
      repeated.predicted,
      repeated.low,
      repeated.high,
      repeated.summary,
    ),
    levelForecast("recent", "Recent median", "Last 20 crashes", recent),
    levelForecast("history", "Full history", "Every saved crash", crashes),
    afterLastForecast(crashes),
    sameBandForecast(crashes),
    copyLastForecast(crashes),
    recentAverageForecast(crashes),
    afterSpikeForecast(crashes),
  ];
}

function afterLastForecast(crashes: number[]): ModelForecast {
  const last = crashes[crashes.length - 1];
  const followed = crashes.filter((_, index) => {
    if (index === 0) return false;
    return Math.abs(Math.log(crashes[index - 1]) - Math.log(last)) <= 0.3;
  });
  const values = followed.length >= 3 ? followed : nearestAfter(crashes, last, 8);
  const predicted = roundMultiplier(plainQuantile(values, 0.5));
  const low = roundMultiplier(plainQuantile(values, 0.25));
  const high = roundMultiplier(plainQuantile(values, 0.75));
  return forecast(
    "after",
    "After last crash",
    `Near ${formatMultiplier(last)}`,
    predicted,
    low,
    high,
    `Crashes near ${formatMultiplier(last)} were followed by a middle crash of ${formatMultiplier(predicted)}.`,
  );
}

function sameBandForecast(crashes: number[]): ModelForecast {
  const mark = bucket(crashes[crashes.length - 1]);
  const names = { L: "under 2x", M: "2x to 5x", H: "5x or more" };
  const followed: number[] = [];
  for (let index = 1; index < crashes.length; index += 1) {
    if (bucket(crashes[index - 1]) === mark) followed.push(crashes[index]);
  }
  const values = followed.length > 0 ? followed : [crashes[crashes.length - 1]];
  const predicted = roundMultiplier(plainQuantile(values, 0.5));
  const low = roundMultiplier(plainQuantile(values, 0.25));
  const high = roundMultiplier(plainQuantile(values, 0.75));
  return forecast(
    "band",
    "Same band",
    `After ${names[mark]}`,
    predicted,
    low,
    high,
    `After a crash ${names[mark]}, the middle next crash was ${formatMultiplier(predicted)}.`,
  );
}

function copyLastForecast(crashes: number[]): ModelForecast {
  const last = roundMultiplier(crashes[crashes.length - 1]);
  return forecast(
    "last",
    "Copy last",
    "Same as newest",
    last,
    last,
    last,
    `This model repeats the newest crash, ${formatMultiplier(last)}.`,
  );
}

function recentAverageForecast(crashes: number[]): ModelForecast {
  const recent = crashes.slice(-10);
  const average = roundMultiplier(Math.exp(recent.reduce((sum, value) => sum + Math.log(value), 0) / recent.length));
  const low = roundMultiplier(plainQuantile(recent, 0.25));
  const high = roundMultiplier(plainQuantile(recent, 0.75));
  return forecast(
    "average",
    "Recent average",
    "Last 10 crashes",
    average,
    Math.min(low, average),
    Math.max(high, average),
    `The average of the last 10 crashes is ${formatMultiplier(average)}.`,
  );
}

function afterSpikeForecast(crashes: number[]): ModelForecast {
  const followed: number[] = [];
  for (let index = 1; index < crashes.length; index += 1) {
    if (crashes[index - 1] >= 5) followed.push(crashes[index]);
  }
  const values = followed.length > 0 ? followed : crashes;
  const predicted = roundMultiplier(plainQuantile(values, 0.5));
  const low = roundMultiplier(plainQuantile(values, 0.25));
  const high = roundMultiplier(plainQuantile(values, 0.75));
  return forecast(
    "spike",
    "After 5x",
    "Follows 5x or more",
    predicted,
    low,
    high,
    `After a crash of 5x or more, the middle next crash was ${formatMultiplier(predicted)}.`,
  );
}

function nearestAfter(crashes: number[], last: number, count: number): number[] {
  return crashes
    .map((value, index) => ({
      value,
      distance: index === 0 ? Number.POSITIVE_INFINITY : Math.abs(Math.log(crashes[index - 1]) - Math.log(last)),
    }))
    .filter((round) => Number.isFinite(round.distance))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, count)
    .map((round) => round.value);
}

function forecast(
  id: ModelId,
  name: string,
  detail: string,
  predicted: number,
  low: number,
  high: number,
  summary: string,
): ModelForecast {
  return { id, name, detail, predicted, low, high, summary };
}

function levelForecast(id: ModelId, name: string, detail: string, values: number[]): ModelForecast {
  const predicted = roundMultiplier(plainQuantile(values, 0.5));
  const low = roundMultiplier(plainQuantile(values, 0.25));
  const high = roundMultiplier(plainQuantile(values, 0.75));
  return forecast(
    id,
    name,
    detail,
    predicted,
    low,
    high,
    `${detail} have a middle crash of ${formatMultiplier(predicted)}, between ${formatMultiplier(low)} and ${formatMultiplier(high)}.`,
  );
}

function repeatValues(crashes: number[]): {
  predicted: number;
  low: number;
  high: number;
  detail: string;
  summary: string;
} {
  const longest = Math.min(8, crashes.length - 1);
  for (let window = longest; window >= 1; window -= 1) {
    const matches: number[] = [];
    for (let index = window; index <= crashes.length - window; index += 1) {
      let matchesLead = true;
      for (let step = 1; step <= window; step += 1) {
        const previous = crashes[index - step];
        const current = crashes[crashes.length - step];
        if (Math.abs(Math.log(previous) - Math.log(current)) > 0.08) {
          matchesLead = false;
          break;
        }
      }
      if (matchesLead) matches.push(crashes[index]);
    }
    if (matches.length === 0) continue;
    const predicted = roundMultiplier(plainQuantile(matches, 0.5));
    const low = roundMultiplier(plainQuantile(matches, 0.25));
    const high = roundMultiplier(plainQuantile(matches, 0.75));
    return {
      predicted,
      low,
      high,
      detail: `${window}-round copy`,
      summary: `A repeated ${window}-round stretch was followed by ${formatMultiplier(predicted)}.`,
    };
  }

  const last = roundMultiplier(crashes[crashes.length - 1]);
  return {
    predicted: last,
    low: last,
    high: last,
    detail: "No earlier copy",
    summary: `No earlier stretch matches the latest crashes. The last crash was ${formatMultiplier(last)}.`,
  };
}

function plainQuantile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
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

function similarRounds(
  crashes: number[],
  salt: number,
  window: number,
): Array<{ value: number; distance: number; weight: number }> {
  const scored: Array<{ value: number; distance: number }> = [];
  for (let index = window; index < crashes.length; index += 1) {
    scored.push({ value: crashes[index], distance: leadDistance(crashes, index, window) });
  }
  scored.sort((left, right) => left.distance - right.distance);
  const within = scored.filter((round) => round.distance <= salt);
  const insideSalt = within.length >= 3;
  const chosen = insideSalt ? within : scored.slice(0, Math.min(5, scored.length));
  return chosen.map((round) => ({
    ...round,
    weight: insideSalt ? Math.exp((-SALT_SHARPNESS * round.distance) / Math.max(salt, 0.05)) : 1,
  }));
}

function leadDistance(crashes: number[], index: number, window: number): number {
  let max = 0;
  const end = crashes.length;
  for (let step = 1; step <= window; step += 1) {
    max = Math.max(max, Math.abs(Math.log(crashes[index - step]) - Math.log(crashes[end - step])));
  }
  return max;
}

function weightedQuantile(
  rounds: Array<{ value: number; weight: number }>,
  quantile: number,
): number {
  const sorted = [...rounds].sort((left, right) => left.value - right.value);
  const total = sorted.reduce((sum, round) => sum + round.weight, 0);
  let covered = 0;
  for (const round of sorted) {
    covered += round.weight;
    if (covered >= total * quantile) return round.value;
  }
  return sorted[sorted.length - 1].value;
}

function roundMultiplier(value: number): number {
  return Math.round(value * 100) / 100;
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
