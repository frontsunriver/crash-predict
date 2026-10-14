import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type LiveRequest = {
  url?: string;
  method?: string;
};

type LiveResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

type Middleware = (req: LiveRequest, res: LiveResponse, next: () => void) => void;

type LiveStatus = "point" | "login" | "idle";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "scripts", "read-live-crash.ps1");

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

  const handler: Middleware = (req, res, next) => {
    if (req.url?.split("?")[0] !== "/api/live-crash") {
      next();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ seq, points, status }));
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
