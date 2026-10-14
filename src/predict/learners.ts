export type LearnedId =
  | "boost"
  | "forest"
  | "mlp"
  | "cnn"
  | "transformer"
  | "lstm"
  | "nbeats"
  | "logistic"
  | "ridge"
  | "survival"
  | "linear"
  | "tree"
  | "svm"
  | "bayes"
  | "knn";

export interface LearnedForecast {
  id: LearnedId;
  name: string;
  detail: string;
  predicted: number;
  low: number;
  high: number;
  summary: string;
}

const LAGS = 5;

interface Row {
  x: number[];
  y: number;
  value: number;
}

export function learnedForecasts(crashes: number[]): LearnedForecast[] {
  const rows = sampleRows(crashes).slice(-64);
  const now = currentFeatures(crashes);
  const fallback = plainQuantile(crashes, 0.5);
  if (rows.length < 4 || now.length === 0) {
    return names().map((item) => pointForecast(item.id, item.name, item.detail, fallback, crashes));
  }

  const ridge = ridgeForecast(rows, now);
  return [
    pointForecast("boost", "Gradient boosting", "XGBoost-style trees", boostPredict(rows, now), crashes, ridge.residuals),
    pointForecast("forest", "Random forest", "Bagged decision trees", forestPredict(rows, now, crashes.length), crashes),
    pointForecast("mlp", "Neural net", "One-hidden-layer MLP", mlpPredict(rows, now, crashes.length), crashes),
    pointForecast("cnn", "CNN", "1D convolution on the series", cnnPredict(crashes), crashes),
    attentionForecast(crashes),
    pointForecast("lstm", "LSTM / GRU", "Recurrent state", lstmPredict(crashes), crashes),
    pointForecast("nbeats", "N-BEATS", "Trend plus seasonal lag", nbeatsPredict(crashes), crashes),
    logisticForecast(rows, now, crashes),
    pointForecast("ridge", "Ridge / Lasso", "Linear lags with shrinkage", ridge.predicted, crashes, ridge.residuals),
    survivalForecast(crashes),
    linearForecast(rows, now, crashes),
    pointForecast("tree", "Decision tree", "Rule-based split", treePredict(rows, now), crashes),
    pointForecast("svm", "SVM", "Margin regression", svmPredict(rows, now), crashes),
    bayesForecast(crashes),
    knnForecast(rows, now),
  ];
}

function names(): Array<{ id: LearnedId; name: string; detail: string }> {
  return [
    { id: "boost", name: "Gradient boosting", detail: "XGBoost-style trees" },
    { id: "forest", name: "Random forest", detail: "Bagged decision trees" },
    { id: "mlp", name: "Neural net", detail: "One-hidden-layer MLP" },
    { id: "cnn", name: "CNN", detail: "1D convolution on the series" },
    { id: "transformer", name: "Transformer", detail: "Attention over past windows" },
    { id: "lstm", name: "LSTM / GRU", detail: "Recurrent state" },
    { id: "nbeats", name: "N-BEATS", detail: "Trend plus seasonal lag" },
    { id: "logistic", name: "Logistic regression", detail: "Chance the next crash reaches 2x" },
    { id: "ridge", name: "Ridge / Lasso", detail: "Linear lags with shrinkage" },
    { id: "survival", name: "Survival model", detail: "Expected time until bust" },
    { id: "linear", name: "Linear regression", detail: "Straight-line baseline" },
    { id: "tree", name: "Decision tree", detail: "Rule-based split" },
    { id: "svm", name: "SVM", detail: "Margin regression" },
    { id: "bayes", name: "Naive Bayes", detail: "Bucket probabilities" },
    { id: "knn", name: "KNN", detail: "Nearest similar rounds" },
  ];
}

function sampleRows(crashes: number[]): Row[] {
  const lags = Math.min(LAGS, crashes.length - 2);
  if (lags < 1) return [];
  const rows: Row[] = [];
  for (let index = lags; index < crashes.length; index += 1) {
    const x = [1];
    for (let lag = 1; lag <= lags; lag += 1) x.push(Math.log(crashes[index - lag]));
    rows.push({ x, y: Math.log(crashes[index]), value: crashes[index] });
  }
  return rows;
}

function currentFeatures(crashes: number[]): number[] {
  const lags = Math.min(LAGS, crashes.length - 2);
  if (lags < 1) return [];
  const x = [1];
  for (let lag = 1; lag <= lags; lag += 1) x.push(Math.log(crashes[crashes.length - lag]));
  return x;
}

function ridgeForecast(rows: Row[], now: number[]): { predicted: number; residuals: number[] } {
  const beta = solveRidge(rows, 0.8, true);
  const predicted = Math.exp(dot(beta, now));
  const residuals = rows.map((row) => row.y - dot(beta, row.x));
  return { predicted, residuals };
}

function boostPredict(rows: Row[], now: number[]): number {
  const mean = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  let fitted = rows.map(() => mean);
  let score = mean;
  for (let round = 0; round < 8; round += 1) {
    const residual = rows.map((row, index) => row.y - fitted[index]);
    const stump = bestStump(rows, residual);
    if (!stump) break;
    for (let index = 0; index < rows.length; index += 1) {
      fitted[index] += 0.35 * (rows[index].x[stump.feature] <= stump.threshold ? stump.left : stump.right);
    }
    score += 0.35 * (now[stump.feature] <= stump.threshold ? stump.left : stump.right);
  }
  return Math.exp(score);
}

function forestPredict(rows: Row[], now: number[], seed: number): number {
  const random = mulberry32(seed + 11);
  let total = 0;
  const trees = 7;
  for (let tree = 0; tree < trees; tree += 1) {
    const sample = Array.from({ length: Math.min(32, rows.length) }, () => rows[Math.floor(random() * rows.length)]);
    const target = sample.map((row) => row.y);
    const first = bestStump(sample, target, Math.floor(random() * (now.length - 1)) + 1);
    if (!first) {
      total += target.reduce((sum, value) => sum + value, 0) / target.length;
      continue;
    }
    const score = now[first.feature] <= first.threshold ? first.left : first.right;
    total += score;
  }
  return Math.exp(total / trees);
}

function mlpPredict(rows: Row[], now: number[], seed: number): number {
  const random = mulberry32(seed + 29);
  const hidden = 8;
  const weights = Array.from({ length: hidden }, () => now.map(() => random() * 2 - 1));
  const bias = Array.from({ length: hidden }, () => random() * 2 - 1);
  const hiddenRows = rows.map((row) => [1, ...activate(weights, bias, row.x)]);
  const beta = solveSystem(hiddenRows, rows.map((row) => row.y), 0.2);
  const score = dot(beta, [1, ...activate(weights, bias, now)]);
  return Math.exp(score);
}

function cnnPredict(crashes: number[]): number {
  const logs = crashes.map((value) => Math.log(value));
  const kernels = [
    [1, 1, 1],
    [-1, 0, 1],
    [1, -2, 1],
  ];
  const rows: number[][] = [];
  const target: number[] = [];
  for (let index = 6; index < crashes.length; index += 1) {
    rows.push([1, ...kernels.map((kernel) => convolveEnd(logs.slice(index - 6, index), kernel))]);
    target.push(logs[index]);
  }
  if (rows.length < 4) return plainQuantile(crashes, 0.5);
  const beta = solveSystem(rows, target, 0.4);
  const now = [1, ...kernels.map((kernel) => convolveEnd(logs.slice(-6), kernel))];
  return Math.exp(dot(beta, now));
}

function attentionForecast(crashes: number[]): LearnedForecast {
  const width = Math.min(8, crashes.length - 2);
  if (width < 2) return pointForecast("transformer", "Transformer", "Attention over past windows", plainQuantile(crashes, 0.5), crashes);
  const query = crashes.slice(-width).map((value) => Math.log(value));
  const weights: number[] = [];
  const values: number[] = [];
  for (let end = width; end < crashes.length; end += 1) {
    const key = crashes.slice(end - width, end).map((value) => Math.log(value));
    let distance = 0;
    for (let step = 0; step < width; step += 1) distance += (query[step] - key[step]) ** 2;
    weights.push(Math.exp(-distance / width));
    values.push(crashes[end]);
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const normalized = weights.map((weight) => weight / total);
  const predicted = normalized.reduce((sum, weight, index) => sum + weight * values[index], 0);
  const low = weightedPlainQuantile(values, normalized, 0.25);
  const high = weightedPlainQuantile(values, normalized, 0.75);
  return {
    id: "transformer",
    name: "Transformer",
    detail: "Attention over past windows",
    predicted: roundMultiplier(predicted),
    low: roundMultiplier(Math.min(low, predicted)),
    high: roundMultiplier(Math.max(high, predicted)),
    summary: `Attention over earlier windows puts the next crash at ${roundMultiplier(predicted).toFixed(2)}x.`,
  };
}

function lstmPredict(crashes: number[]): number {
  const logs = crashes.map((value) => Math.log(value));
  let bestScore = logs[logs.length - 1];
  let bestSse = Number.POSITIVE_INFINITY;
  for (const decay of [0.55, 0.75, 0.9]) {
    const states: number[] = [];
    let state = 0;
    for (const value of logs) {
      states.push(state);
      state = decay * state + (1 - decay) * value;
    }
    const rows = states.slice(1).map((hidden, index) => [1, hidden, logs[index]]);
    const target = logs.slice(1);
    const beta = solveSystem(rows, target, 0.1);
    const sse = target.reduce((sum, value, index) => sum + (value - dot(beta, rows[index])) ** 2, 0);
    if (sse < bestSse) {
      bestSse = sse;
      bestScore = dot(beta, [1, states[states.length - 1], logs[logs.length - 1]]);
    }
  }
  return Math.exp(bestScore);
}

function nbeatsPredict(crashes: number[]): number {
  const logs = crashes.map((value) => Math.log(value));
  const tail = logs.slice(-24);
  const rows = tail.map((_, index) => [1, index / Math.max(tail.length - 1, 1), (index / Math.max(tail.length - 1, 1)) ** 2]);
  const beta = solveSystem(rows, tail, 0.05);
  const step = tail.length / Math.max(tail.length - 1, 1);
  const trend = dot(beta, [1, step, step ** 2]);
  const phase = crashes.length % 5;
  const seasonal: number[] = [];
  for (let index = phase; index < logs.length - 1; index += 5) seasonal.push(logs[index + 1] - logs[index]);
  const drift = seasonal.length ? seasonal.reduce((sum, value) => sum + value, 0) / seasonal.length : 0;
  return Math.exp(0.65 * trend + 0.35 * (logs[logs.length - 1] + drift));
}

function logisticForecast(rows: Row[], now: number[], crashes: number[]): LearnedForecast {
  let beta = now.map(() => 0);
  const labels = rows.map((row) => (row.value >= 2 ? 1 : 0));
  for (let step = 0; step < 24; step += 1) {
    const gradient = now.map(() => 0);
    for (let index = 0; index < rows.length; index += 1) {
      const prediction = sigmoid(dot(beta, rows[index].x));
      const error = prediction - labels[index];
      for (let feature = 0; feature < beta.length; feature += 1) gradient[feature] += error * rows[index].x[feature];
    }
    beta = beta.map((value, feature) => value - (0.08 * gradient[feature]) / rows.length - 0.01 * value);
  }
  const probability = sigmoid(dot(beta, now));
  const below = crashes.filter((value) => value < 2);
  const above = crashes.filter((value) => value >= 2);
  const lowLevel = below.length ? plainQuantile(below, 0.5) : 1;
  const highLevel = above.length ? plainQuantile(above, 0.5) : plainQuantile(crashes, 0.75);
  const predicted = Math.exp((1 - probability) * Math.log(lowLevel) + probability * Math.log(highLevel));
  return {
    id: "logistic",
    name: "Logistic regression",
    detail: "Chance the next crash reaches 2x",
    predicted: roundMultiplier(predicted),
    low: roundMultiplier(Math.min(lowLevel, predicted)),
    high: roundMultiplier(Math.max(highLevel, predicted)),
    summary: `Logistic regression gives a ${(probability * 100).toFixed(0)}% chance the next crash reaches 2x, for an estimate of ${roundMultiplier(predicted).toFixed(2)}x.`,
  };
}

function survivalForecast(crashes: number[]): LearnedForecast {
  const last = Math.log(crashes[crashes.length - 1]);
  const followed = crashes.filter((_, index) => index > 0 && Math.abs(Math.log(crashes[index - 1]) - last) <= 0.45);
  const sample = followed.length >= 12 ? followed : crashes;
  const edges = [1, 1.5, 2, 3, 5, 10, 20, 100];
  const counts = edges.slice(0, -1).map(() => 0);
  for (const value of sample) {
    const bucket = edges.findIndex((edge, index) => index < edges.length - 1 && value >= edge && value < edges[index + 1]);
    if (bucket >= 0) counts[bucket] += 1;
  }
  const total = counts.reduce((sum, count) => sum + count, 0) || 1;
  let predicted = 0;
  counts.forEach((count, index) => {
    const midpoint = Math.sqrt(edges[index] * edges[index + 1]);
    predicted += (count / total) * midpoint;
  });
  return pointForecast("survival", "Survival model", "Expected time until bust", predicted, sample);
}

function linearForecast(rows: Row[], now: number[], crashes: number[]): LearnedForecast {
  const beta = solveSystem(rows.map((row) => row.x), rows.map((row) => row.y), 1e-4);
  const residuals = rows.map((row) => row.y - dot(beta, row.x));
  return pointForecast("linear", "Linear regression", "Straight-line baseline", Math.exp(dot(beta, now)), crashes, residuals);
}

function treePredict(rows: Row[], now: number[]): number {
  return Math.exp(treeScore(rows, rows.map((row) => row.y), now, 0));
}

function treeScore(rows: Row[], target: number[], now: number[], depth: number): number {
  if (rows.length < 6 || depth >= 2) return average(target);
  const stump = bestStump(rows, target);
  if (!stump) return average(target);
  const goLeft = now[stump.feature] <= stump.threshold;
  const nextRows: Row[] = [];
  const nextTarget: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if ((rows[index].x[stump.feature] <= stump.threshold) === goLeft) {
      nextRows.push(rows[index]);
      nextTarget.push(target[index]);
    }
  }
  if (nextRows.length < 4) return goLeft ? stump.left : stump.right;
  return treeScore(nextRows, nextTarget, now, depth + 1);
}

function svmPredict(rows: Row[], now: number[]): number {
  let beta = now.map(() => 0);
  const epsilon = 0.2;
  for (let step = 0; step < 16; step += 1) {
    const gradient = beta.map((value, feature) => (feature === 0 ? 0 : 0.05 * value));
    for (const row of rows) {
      const error = dot(beta, row.x) - row.y;
      if (Math.abs(error) <= epsilon) continue;
      const sign = error > 0 ? 1 : -1;
      for (let feature = 0; feature < beta.length; feature += 1) gradient[feature] += sign * row.x[feature];
    }
    beta = beta.map((value, feature) => Math.max(-3, Math.min(3, value - (0.04 * gradient[feature]) / rows.length)));
  }
  return Math.exp(dot(beta, now));
}

function bayesForecast(crashes: number[]): LearnedForecast {
  const edges = [1, 1.5, 2, 3, 5, 10, 100];
  const bins = edges.length - 1;
  const counts = Array.from({ length: bins }, () => Array(bins).fill(1));
  for (let index = 1; index < crashes.length; index += 1) {
    counts[crashBin(crashes[index - 1], edges)][crashBin(crashes[index], edges)] += 1;
  }
  const row = counts[crashBin(crashes[crashes.length - 1], edges)];
  const total = row.reduce((sum, count) => sum + count, 0);
  let predicted = 0;
  row.forEach((count, index) => {
    predicted += (count / total) * Math.sqrt(edges[index] * edges[index + 1]);
  });
  return pointForecast("bayes", "Naive Bayes", "Bucket probabilities", predicted, crashes);
}

function knnForecast(rows: Row[], now: number[]): LearnedForecast {
  const neighbors = rows
    .map((row) => {
      let distance = 0;
      for (let feature = 1; feature < now.length; feature += 1) distance += (row.x[feature] - now[feature]) ** 2;
      return { value: row.value, distance: Math.sqrt(distance) };
    })
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 7);
  let weight = 0;
  let score = 0;
  for (const neighbor of neighbors) {
    const share = 1 / (neighbor.distance + 0.05);
    weight += share;
    score += share * Math.log(neighbor.value);
  }
  return pointForecast(
    "knn",
    "KNN",
    "Nearest similar rounds",
    Math.exp(score / (weight || 1)),
    neighbors.map((neighbor) => neighbor.value),
  );
}

function crashBin(value: number, edges: number[]): number {
  const bin = edges.findIndex((edge, index) => index < edges.length - 1 && value >= edge && value < edges[index + 1]);
  return bin >= 0 ? bin : edges.length - 2;
}

function pointForecast(
  id: LearnedId,
  name: string,
  detail: string,
  predicted: number,
  sample: number[],
  residuals?: number[],
): LearnedForecast {
  const center = roundMultiplier(predicted);
  const low = residuals
    ? roundMultiplier(Math.exp(Math.log(center) + plainQuantile(residuals, 0.25)))
    : roundMultiplier(plainQuantile(sample, 0.25));
  const high = residuals
    ? roundMultiplier(Math.exp(Math.log(center) + plainQuantile(residuals, 0.75)))
    : roundMultiplier(plainQuantile(sample, 0.75));
  return {
    id,
    name,
    detail,
    predicted: center,
    low: Math.min(low, center),
    high: Math.max(high, center),
    summary: `${name} puts the next crash at ${center.toFixed(2)}x.`,
  };
}

interface Stump {
  feature: number;
  threshold: number;
  left: number;
  right: number;
}

function bestStump(rows: Row[], target: number[], lockedFeature?: number): Stump | null {
  if (rows.length === 0) return null;
  const features = lockedFeature ? [lockedFeature] : rows[0].x.map((_, index) => index).filter((index) => index > 0);
  let best: Stump | null = null;
  let bestSse = Number.POSITIVE_INFINITY;
  for (const feature of features) {
    const values = rows.map((row) => row.x[feature]).sort((left, right) => left - right);
    const candidates = [0.25, 0.5, 0.75].map((quantile) => values[Math.min(values.length - 1, Math.floor(values.length * quantile))]);
    for (const threshold of candidates) {
      const left: number[] = [];
      const right: number[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        (rows[index].x[feature] <= threshold ? left : right).push(target[index]);
      }
      if (left.length === 0 || right.length === 0) continue;
      const leftMean = average(left);
      const rightMean = average(right);
      const sse = left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0) + right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0);
      if (sse < bestSse) {
        bestSse = sse;
        best = { feature, threshold, left: leftMean, right: rightMean };
      }
    }
  }
  return best;
}

function solveRidge(rows: Row[], lambda: number, shrinkLasso: boolean): number[] {
  const beta = solveSystem(rows.map((row) => row.x), rows.map((row) => row.y), lambda);
  if (!shrinkLasso) return beta;
  return beta.map((value, index) => (index === 0 || Math.abs(value) >= 0.04 ? value : 0));
}

function solveSystem(rows: number[][], target: number[], lambda: number): number[] {
  const width = rows[0].length;
  const xtx = Array.from({ length: width }, () => Array(width).fill(0));
  const xty = Array(width).fill(0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let left = 0; left < width; left += 1) {
      xty[left] += rows[rowIndex][left] * target[rowIndex];
      for (let right = 0; right < width; right += 1) xtx[left][right] += rows[rowIndex][left] * rows[rowIndex][right];
    }
  }
  for (let index = 0; index < width; index += 1) xtx[index][index] += index === 0 ? lambda * 0.01 : lambda;
  return solve(xtx, xty);
}

function solve(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const scale = rows[column][column] || 1e-8;
    for (let columnIndex = column; columnIndex <= size; columnIndex += 1) rows[column][columnIndex] /= scale;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let columnIndex = column; columnIndex <= size; columnIndex += 1) {
        rows[row][columnIndex] -= factor * rows[column][columnIndex];
      }
    }
  }
  return rows.map((row) => row[size]);
}

function activate(weights: number[][], bias: number[], input: number[]): number[] {
  return weights.map((row, index) => Math.tanh(dot(row, input) + bias[index]));
}

function convolveEnd(series: number[], kernel: number[]): number {
  const start = Math.max(0, series.length - kernel.length);
  let total = 0;
  for (let index = 0; index < kernel.length && start + index < series.length; index += 1) {
    total += series[start + index] * kernel[index];
  }
  return total;
}

function weightedPlainQuantile(values: number[], weights: number[], quantile: number): number {
  const order = values.map((value, index) => ({ value, weight: weights[index] })).sort((left, right) => left.value - right.value);
  const total = order.reduce((sum, item) => sum + item.weight, 0);
  let covered = 0;
  for (const item of order) {
    covered += item.weight;
    if (covered >= total * quantile) return item.value;
  }
  return order[order.length - 1].value;
}

function plainQuantile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 1;
}

function dot(left: number[], right: number[]): number {
  let total = 0;
  const width = Math.min(left.length, right.length);
  for (let index = 0; index < width; index += 1) total += left[index] * right[index];
  return total;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sigmoid(value: number): number {
  const clipped = Math.max(-20, Math.min(20, value));
  return 1 / (1 + Math.exp(-clipped));
}

function roundMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(500, Math.max(1, Math.round(value * 100) / 100));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
