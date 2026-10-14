import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const CRASH_BATCH_SIZE = 200;

export type CrashStore = {
  count: () => number;
  all: () => number[];
  append: (points: number[]) => { added: number; count: number };
  close: () => void;
};

export function openCrashStore(filePath: string): CrashStore {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS crashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value REAL NOT NULL
    )
  `);

  const countStatement = db.prepare("SELECT COUNT(*) AS count FROM crashes");
  const allStatement = db.prepare("SELECT value FROM crashes ORDER BY id ASC");
  const insert = db.prepare("INSERT INTO crashes (value) VALUES (?)");
  const insertBatch = db.transaction((rows: number[]) => {
    for (const value of rows) insert.run(value);
  });

  return {
    count() {
      const row = countStatement.get() as { count: number };
      return row.count;
    },
    all() {
      return (allStatement.all() as Array<{ value: number }>).map((row) => row.value);
    },
    append(points) {
      const clean = points.filter((value) => Number.isFinite(value) && value >= 1 && value <= 1_000_000);
      if (clean.length > CRASH_BATCH_SIZE) {
        throw new Error(`Store at most ${CRASH_BATCH_SIZE} crash points at a time.`);
      }
      if (clean.length > 0) insertBatch(clean);
      return { added: clean.length, count: this.count() };
    },
    close() {
      db.close();
    },
  };
}

export function appendCrashBatches(store: CrashStore, points: number[]): { added: number; count: number } {
  let added = 0;
  let count = store.count();
  for (let index = 0; index < points.length; index += CRASH_BATCH_SIZE) {
    const result = store.append(points.slice(index, index + CRASH_BATCH_SIZE));
    added += result.added;
    count = result.count;
  }
  return { added, count };
}
