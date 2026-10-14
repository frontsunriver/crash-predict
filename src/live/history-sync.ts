export const CRASH_BATCH_SIZE = 200;

export function batchesOf<T>(items: T[], size = CRASH_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export function unsavedTail(stored: number[], local: number[]): number[] {
  if (local.length < stored.length) return [];
  for (let index = 0; index < stored.length; index += 1) {
    if (Math.abs(stored[index] - local[index]) > 0.001) return [];
  }
  return local.slice(stored.length);
}

export async function fetchCrashPoints(): Promise<number[]> {
  const response = await fetch("/api/crash-points");
  if (!response.ok) throw new Error("Could not load crash points.");
  const data = (await response.json()) as { points?: number[] };
  return (data.points ?? []).filter((value) => Number.isFinite(value) && value >= 1);
}

export async function storeCrashPoints(points: number[]): Promise<number> {
  let stored = 0;
  for (const batch of batchesOf(points)) {
    const response = await fetch("/api/crash-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: batch }),
    });
    if (!response.ok) throw new Error("Could not store crash points.");
    stored += batch.length;
  }
  return stored;
}
