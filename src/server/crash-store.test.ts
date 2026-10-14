import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendCrashBatches, openCrashStore } from "./crash-store";

const files: string[] = [];

afterEach(() => {
  for (const file of files.splice(0)) {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  }
});

function tempStore() {
  const file = path.join(os.tmpdir(), `crycodi-crashes-${Date.now()}-${Math.random()}.sqlite`);
  files.push(file);
  return openCrashStore(file);
}

describe("crash store", () => {
  it("keeps every crash point and writes new points 200 at a time", () => {
    const store = tempStore();
    const points = Array.from({ length: 450 }, (_, index) => index + 1);
    const result = appendCrashBatches(store, points);
    expect(result.added).toBe(450);
    expect(result.count).toBe(450);
    expect(store.all()).toEqual(points);
    store.close();
  });

  it("rejects a single write larger than 200 points", () => {
    const store = tempStore();
    expect(() => store.append(Array.from({ length: 201 }, () => 1.2))).toThrow(/200/);
    expect(store.count()).toBe(0);
    store.close();
  });

  it("reopens the same database with the saved points", () => {
    const file = path.join(os.tmpdir(), `crycodi-crashes-reopen-${Date.now()}.sqlite`);
    files.push(file);
    const first = openCrashStore(file);
    first.append([1.15, 1.9]);
    first.close();
    const second = openCrashStore(file);
    expect(second.all()).toEqual([1.15, 1.9]);
    second.close();
  });
});
