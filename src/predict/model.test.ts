import { describe, expect, it } from "vitest";
import { appendLivePoints, formatHistory, parseCrashPoints, predict, sampleCrashes } from "./model";

function repeatingEdge(): number[] {
  const crashes: number[] = [];
  for (let index = 0; index < 20; index += 1) crashes.push(1.1, 1.1, 1.1, 3);
  crashes.push(1.1, 1.1, 1.1);
  return crashes;
}

describe("parseCrashPoints", () => {
  it("reads multipliers with x suffixes and separators", () => {
    expect(parseCrashPoints("1.20x 1.05x\n8.40")).toEqual([1.2, 1.05, 8.4]);
  });

  it("reads a comma as a decimal when a token has no dot", () => {
    expect(parseCrashPoints("1,20")).toEqual([1.2]);
  });

  it("splits comma-separated dotted multipliers", () => {
    expect(parseCrashPoints("1.2, 3.4, 2.2")).toEqual([1.2, 3.4, 2.2]);
  });

  it("drops values below 1 and ignores comment lines", () => {
    expect(parseCrashPoints("# notes\n0.4\n1.5\n2")).toEqual([1.5, 2]);
  });
});

describe("formatHistory", () => {
  it("writes a text file that loads back to the same points", () => {
    const points = [1.2, 1.05, 8.4];
    const text = formatHistory(points);
    expect(text.startsWith("# Crycodi crash history\n")).toBe(true);
    expect(parseCrashPoints(text)).toEqual(points);
  });
});

describe("appendLivePoints", () => {
  it("uses the live list when the local history is empty", () => {
    expect(appendLivePoints([], [1.2, 1.5, 3])).toEqual([1.2, 1.5, 3]);
  });

  it("appends only the new last crash point", () => {
    expect(appendLivePoints([1, 1.2, 1.5], [1.2, 1.5, 3])).toEqual([1, 1.2, 1.5, 3]);
  });

  it("appends a repeated crash when it is a new round", () => {
    expect(appendLivePoints([1.2, 1.5], [1.2, 1.5, 1.5])).toEqual([1.2, 1.5, 1.5]);
  });

  it("leaves the history unchanged when the live list is already included", () => {
    expect(appendLivePoints([1, 1.2, 1.5, 3], [1.2, 1.5, 3])).toEqual([1, 1.2, 1.5, 3]);
  });
});

describe("predict", () => {
  it("asks for more crash points before predicting", () => {
    const result = predict({ crashes: [1.2, 1.4, 2.2] });
    expect(result.status).toBe("need-data");
  });

  it("predicts the crash that followed the same lead-in", () => {
    const result = predict({ crashes: repeatingEdge() });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.readiness).toBe("ready");
    expect(result.predicted).toBe(3);
    expect(result.low).toBe(3);
    expect(result.high).toBe(3);
    expect(result.similarCount).toBe(20);
  });

  it("marks a short match as an early read", () => {
    const result = predict({
      crashes: [1.1, 1.1, 1.1, 3, 1.1, 1.1, 1.1],
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.readiness).toBe("early");
    expect(result.similarCount).toBeLessThan(8);
  });

  it("predicts the repeated crash point", () => {
    const result = predict({ crashes: Array.from({ length: 40 }, () => 1.01) });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.predicted).toBeCloseTo(1.01);
    expect(result.readiness).toBe("ready");
  });

  it("predicts from the sample history without a stake", () => {
    const crashes = sampleCrashes();
    expect(crashes).toHaveLength(80);
    const result = predict({ crashes });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.predicted).toBeGreaterThanOrEqual(1);
  });
});
