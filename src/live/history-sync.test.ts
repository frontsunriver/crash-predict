import { describe, expect, it } from "vitest";
import { batchesOf, unsavedTail } from "./history-sync";

describe("history sync", () => {
  it("splits a long add into batches of 200", () => {
    const batches = batchesOf(Array.from({ length: 450 }, (_, index) => index + 1));
    expect(batches.map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(batches[0][0]).toBe(1);
    expect(batches[2][49]).toBe(450);
  });

  it("returns only points added after the stored list", () => {
    expect(unsavedTail([1.1, 1.2], [1.1, 1.2, 3.4])).toEqual([3.4]);
    expect(unsavedTail([1.1, 1.2, 3.4], [1.1, 1.2])).toEqual([]);
    expect(unsavedTail([1.1, 9], [1.1, 1.2, 3.4])).toEqual([]);
  });
});