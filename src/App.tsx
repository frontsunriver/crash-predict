import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  appendLivePoints,
  formatHistory,
  formatMultiplier,
  parseCrashPoints,
  patternPhrase,
  predict,
  sampleCrashes,
  type ReadyPrediction,
} from "./predict/model";

const SAMPLE = sampleCrashes()
  .map((value) => value.toFixed(2))
  .join("\n");

export function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState("");
  const [usingSample, setUsingSample] = useState(false);
  const [draft, setDraft] = useState("");
  const [fileNote, setFileNote] = useState("");
  const [liveStatus, setLiveStatus] = useState<"point" | "login" | "idle">("idle");

  const crashes = useMemo(() => parseCrashPoints(raw), [raw]);
  const prediction = useMemo(() => predict({ crashes }), [crashes]);
  const lastPoint = crashes.length > 0 ? crashes[crashes.length - 1] : null;

  function addPoint(event: FormEvent) {
    event.preventDefault();
    const points = parseCrashPoints(draft);
    if (points.length === 0) return;
    const next = points.map((value) => value.toFixed(2)).join("\n");
    setRaw((current) => (current.trim() ? `${current.trim()}\n${next}` : next));
    setUsingSample(false);
    setDraft("");
    setFileNote("");
  }

  function loadSample() {
    setRaw(SAMPLE);
    setUsingSample(true);
    setFileNote("");
  }

  function clearHistory() {
    setRaw("");
    setUsingSample(false);
    setFileNote("");
  }

  function saveHistory() {
    if (crashes.length === 0) return;
    const text = formatHistory(crashes);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "crash-history.txt";
    link.click();
    URL.revokeObjectURL(url);
    setFileNote("Saved crash-history.txt. Use Load history later to open that file.");
  }

  useEffect(() => {
    let seen = 0;
    let stopped = false;

    async function pullLiveCrash() {
      try {
        const response = await fetch("/api/live-crash");
        if (!response.ok) return;
        const data = (await response.json()) as {
          seq?: number;
          points?: number[];
          status?: "point" | "login" | "idle";
        };
        if (stopped) return;
        if (data.status) setLiveStatus(data.status);
        if (!data.seq || data.seq === seen || !data.points?.length) return;
        seen = data.seq;
        setRaw((current) => {
          const existing = parseCrashPoints(current);
          const merged = appendLivePoints(existing, data.points ?? []);
          if (merged.length === existing.length) return current;
          const extra = merged.slice(existing.length).map((value) => value.toFixed(2));
          setUsingSample(false);
          setFileNote(`Added ${extra[extra.length - 1]}x from CRYGODI as the last crash point.`);
          return current.trim() ? `${current.trim()}\n${extra.join("\n")}` : extra.join("\n");
        });
      } catch {
        // The live route is only present while this app server is running.
      }
    }

    void pullLiveCrash();
    const timer = window.setInterval(() => {
      void pullLiveCrash();
    }, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  function openHistory(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const points = parseCrashPoints(text);
      if (points.length === 0) {
        setFileNote(`${file.name} has no crash points. Put one multiplier on each line, such as 1.84.`);
        return;
      }
      setRaw(text.trim());
      setUsingSample(false);
      setFileNote(`Loaded ${points.length} points from ${file.name}.`);
    };
    reader.readAsText(file);
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Mark />
          <div>
            <p className="eyebrow">Crycodi</p>
            <h1>Crash Predict</h1>
          </div>
        </div>
        <p className="lede">
          Enter crash points only, newest last. The latest CRYGODI result can be added
          automatically as the last point, and the next crash is predicted from that history.
        </p>
      </header>

      <main className="layout">
        <section className="decision" aria-live="polite">
          {prediction.status === "need-data" ? (
            <NeedData message={prediction.message} count={crashes.length} lastPoint={lastPoint} />
          ) : (
            <Decision prediction={prediction} lastPoint={lastPoint} />
          )}
        </section>

        <section className="panel entry">
          <div className="live">
            <p>Auto last crash</p>
            <strong>{liveStatusText(liveStatus)}</strong>
          </div>

          <form onSubmit={addPoint} className="add-form">
            <label htmlFor="draft">Add a crash point</label>
            <div className="add-row">
              <input
                id="draft"
                inputMode="decimal"
                placeholder="1.84"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit">Add</button>
            </div>
          </form>

          <label htmlFor="history">
            Crash history
            <span>{crashes.length} valid points</span>
          </label>
          <textarea
            id="history"
            spellCheck={false}
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              setUsingSample(false);
              setFileNote("");
            }}
            placeholder={"1.08\n1.42\n3.60\n1.15"}
          />
          <div className="actions">
            <button type="button" onClick={saveHistory} disabled={crashes.length === 0}>
              Save history
            </button>
            <button type="button" className="ghost" onClick={() => fileInput.current?.click()}>
              Load history
            </button>
            <button type="button" className="ghost" onClick={loadSample}>
              Load sample
            </button>
            <button type="button" className="ghost" onClick={clearHistory}>
              Clear
            </button>
          </div>
          <input
            ref={fileInput}
            className="file-input"
            type="file"
            accept=".txt,text/plain"
            aria-label="Load crash history text file"
            onChange={openHistory}
          />
          {usingSample && (
            <p className="note">Sample history is loaded. Save it, or replace it with your points.</p>
          )}
          {fileNote && <p className="note">{fileNote}</p>}
        </section>
      </main>

      {prediction.status === "ready" && <Details crashes={crashes} prediction={prediction} />}

      <footer>
        The text file is one crash point per line, oldest first and newest last. Lines that start
        with # are notes. The predicted point is the middle of similar past rounds, so the next
        round can still land outside that range.
      </footer>
    </div>
  );
}

function liveStatusText(status: "point" | "login" | "idle"): string {
  if (status === "login") {
    return "CRYGODI is on the login page. Open the crash game and each new result is added here as the last point.";
  }
  if (status === "point") return "The newest CRYGODI crash is added here automatically.";
  return "Waiting for a crash result from the CRYGODI window.";
}

function Decision({
  prediction,
  lastPoint,
}: {
  prediction: ReadyPrediction;
  lastPoint: number | null;
}) {
  const early = prediction.readiness === "early";

  return (
    <>
      <div className={`signal ${early ? "signal-wait" : "signal-bet"}`}>
        <span>{early ? "Early" : "Predict"}</span>
        <strong>{early ? "Need a longer history" : "Next crash estimate"}</strong>
      </div>

      <div className="figures">
        {lastPoint != null && (
          <article>
            <p>Last crash</p>
            <strong>{formatMultiplier(lastPoint)}</strong>
            <em>Newest point in the history</em>
          </article>
        )}
        <article>
          <p>Predicted crash</p>
          <strong>{formatMultiplier(prediction.predicted)}</strong>
          <em>Median crash after this lead-in</em>
        </article>
        <article>
          <p>Likely range</p>
          <strong className="range">
            {formatMultiplier(prediction.low)} – {formatMultiplier(prediction.high)}
          </strong>
          <em>Half of the similar rounds landed here</em>
        </article>
      </div>

      <dl className="meters">
        <div>
          <dt>Similar rounds</dt>
          <dd>{prediction.similarCount}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd className="confidence">{prediction.confidence}</dd>
        </div>
        <div>
          <dt>Lead-in length</dt>
          <dd>{prediction.window} rounds</dd>
        </div>
      </dl>

      <p className="explain">{explain(prediction)}</p>

      <div className="lead">
        <span>Lead-in</span>
        {prediction.leadIn.map((value, index) => (
          <b key={`${value}-${index}`} className={`chip chip-${band(value)}`}>
            {formatMultiplier(value)}
          </b>
        ))}
        <em>{patternPhrase(prediction.pattern)}</em>
      </div>
    </>
  );
}

function NeedData({
  message,
  count,
  lastPoint,
}: {
  message: string;
  count: number;
  lastPoint: number | null;
}) {
  return (
    <div className="empty">
      <p className="eyebrow">Waiting for history</p>
      <h2>{message}</h2>
      <p>
        {count} valid crash point{count === 1 ? "" : "s"} so far.
        {lastPoint != null ? ` Last one is ${formatMultiplier(lastPoint)}.` : ""} Add points, load a
        text file, or leave the CRYGODI crash game open.
      </p>
    </div>
  );
}

function Details({ crashes, prediction }: { crashes: number[]; prediction: ReadyPrediction }) {
  const shown = crashes.slice(-48);
  const scale = Math.max(...shown.map((value) => Math.min(value, 12)), 2);

  return (
    <section className="details">
      <article className="panel">
        <header>
          <h2>Recent crashes</h2>
          <p>Last {shown.length} points. Height is capped at 12x so early busts stay visible.</p>
        </header>
        <div className="chart" role="img" aria-label="Recent crash points">
          {shown.map((value, index) => (
            <div key={`${value}-${index}`} className="bar-wrap" title={formatMultiplier(value)}>
              <div
                className={`bar bar-${band(value)}`}
                style={{ height: `${(Math.min(value, 12) / scale) * 100}%` }}
              />
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <header>
          <h2>How often history reached a multiplier</h2>
          <p>Share of every crash point in the loaded history.</p>
        </header>
        <ul className="reach">
          {prediction.reached.map((option) => (
            <li key={option.target}>
              <span>{formatMultiplier(option.target)}</span>
              <div className="track">
                <div style={{ width: `${Math.min(option.hitRate, 1) * 100}%` }} />
              </div>
              <b>{percent(option.hitRate)}</b>
            </li>
          ))}
        </ul>
        <p className="note">
          Similar crashes sat between {formatMultiplier(prediction.low)} and{" "}
          {formatMultiplier(prediction.high)}. The predicted point is{" "}
          {formatMultiplier(prediction.predicted)}.
        </p>
      </article>
    </section>
  );
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" />
      <path d="M8 32c6-2 8-14 14-14s6 10 12 8 4-12 6-14" />
    </svg>
  );
}

function explain(prediction: ReadyPrediction): string {
  const predicted = formatMultiplier(prediction.predicted);
  const low = formatMultiplier(prediction.low);
  const high = formatMultiplier(prediction.high);

  if (prediction.readiness === "early") {
    return `Only ${prediction.similarCount} past rounds match this lead-in. Their middle crash was ${predicted}, between ${low} and ${high}. Add more points before treating that as a stable prediction.`;
  }

  return `After a lead-in like this, ${prediction.similarCount} similar rounds crashed at a middle value of ${predicted}. Half of them landed between ${low} and ${high}.`;
}

function band(value: number): "low" | "mid" | "high" {
  if (value < 2) return "low";
  if (value < 5) return "mid";
  return "high";
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
