import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendCrashBatches, openCrashStore, type CrashStore } from "./src/server/crash-store";

type LiveRequest = {
  url?: string;
  method?: string;
  on?: (event: string, listener: (...args: never[]) => void) => void;
};

type LiveResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

type Middleware = (req: LiveRequest, res: LiveResponse, next: () => void) => void;

type LiveStatus = "point" | "login" | "idle";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(rootDir, "scripts", "read-live-crash.ps1");
const databasePath = path.join(rootDir, "data", "crash-points.sqlite");

export function crashLivePlugin() {
  let seq = 0;
  let points: number[] = [];
  let status: LiveStatus = "idle";
  let signature = "";
  let timer: NodeJS.Timeout | undefined;
  let busy = false;

  const readWindow = () =>
    new Promise<string>((resolve) => {
      execFile(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
        { timeout: 8000, windowsHide: true },
        (error, stdout) => {
          resolve(error ? "IDLE" : String(stdout).trim());
        },
      );
    });

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const text = (await readWindow()).split(/\r?\n/).filter(Boolean).at(-1) ?? "IDLE";
      if (text === "LOGIN") {
        status = "login";
        return;
      }
      const parsed = text
        .split(",")
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 1);
      if (text === "IDLE" || parsed.length === 0) {
        status = "idle";
        return;
      }
      status = "point";
      const nextSignature = parsed.join(",");
      if (nextSignature === signature) return;
      signature = nextSignature;
      points = parsed;
      seq += 1;
    } finally {
      busy = false;
    }
  };

  const start = () => {
    if (process.env.VITEST || timer) return;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, 2000);
  };

  let store: CrashStore | undefined;
  const crashes = () => {
    store ??= openCrashStore(databasePath);
    return store;
  };

  const handler: Middleware = (req, res, next) => {
    const pathname = req.url?.split("?")[0];
    if (pathname !== "/api/live-crash" && pathname !== "/api/crash-points") {
      next();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (pathname === "/api/live-crash") {
      res.end(JSON.stringify({ seq, points, status }));
      return;
    }
    void handleCrashPoints(req, res, crashes());
  };

  return {
    name: "crycodi-live-crash",
    configureServer(server: { middlewares: { use: (handler: Middleware) => void } }) {
      start();
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: { middlewares: { use: (handler: Middleware) => void } }) {
      start();
      server.middlewares.use(handler);
    },
  };
}

function readBody(req: LiveRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!req.on) {
      reject(new Error("This request has no body."));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk?: Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => reject(new Error("Could not read the crash points.")));
  });
}

async function handleCrashPoints(req: LiveRequest, res: LiveResponse, store: CrashStore) {
  try {
    if (req.method === "GET") {
      const points = store.all();
      res.end(JSON.stringify({ count: points.length, points }));
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Use GET or POST." }));
      return;
    }
    const body = JSON.parse(await readBody(req)) as { points?: unknown };
    const points = Array.isArray(body.points) ? body.points.map(Number) : [];
    const result = appendCrashBatches(store, points);
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Could not store crash points." }));
  }
}
