import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { batchesOf, fetchCrashPoints, storeCrashPoints, unsavedTail } from "./live/history-sync";
import {
  appendLivePoints,
  DEFAULT_SALT,
  formatHistory,
  formatMultiplier,
  parseCrashPoints,
  patternPhrase,
  predict,
  sampleCrashes,
  studyModel,
  type ModelFit,
  type ModelId,
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
  const [salt, setSalt] = useState(String(DEFAULT_SALT));
  const [model, setModel] = useState<ModelId>("similar");
  const [fits, setFits] = useState<ModelFit[]>([]);
  const studiedCount = useRef<number | null>(null);
  const [loadingDatabase, setLoadingDatabase] = useState(false);
  const [studying, setStudying] = useState(false);
  const storedRef = useRef<number[] | null>(null);
  const crashesRef = useRef<number[]>([]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const crashes = useMemo(() => parseCrashPoints(raw), [raw]);
  crashesRef.current = crashes;
  const saltValue = Number(salt);
  const prediction = useMemo(
    () => predict({ crashes, salt: saltValue > 0 ? saltValue : DEFAULT_SALT, model }),
    [crashes, saltValue, model],
  );
  const lastPoint = crashes.length > 0 ? crashes[crashes.length - 1] : null;

  useEffect(() => {
    if (studiedCount.current != null && crashes.length !== studiedCount.current) {
      studiedCount.current = null;
      setFits([]);
    }
  }, [crashes.length]);

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

  useEffect(() => {
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (storedRef.current === null) storedRef.current = await fetchCrashPoints();
        const extra = unsavedTail(storedRef.current, crashesRef.current);
        if (extra.length === 0) return;
        for (const batch of batchesOf(extra)) {
          await storeCrashPoints(batch);
          storedRef.current = [...storedRef.current, ...batch];
        }
        if (extra.length >= 200) {
          setFileNote(`Stored ${extra.length} crash points in the database, 200 at a time.`);
        }
      })
      .catch(() => {
        setFileNote("Could not store crash points in the database. Keep this app server running.");
      });
  }, [crashes]);

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const points = await fetchCrashPoints();
        if (stopped || points.length === 0) return;
        storedRef.current = points;
        setUsingSample(false);
        setRaw(points.map((value) => value.toFixed(2)).join("\n"));
        setFileNote(`Predicting from ${points.length} crash points in the database.`);
      } catch {
        // The database route is only present while this app server is running.
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  async function loadDatabase() {
    setLoadingDatabase(true);
    try {
      await saveQueue.current.catch(() => undefined);
      const points = await fetchCrashPoints();
      storedRef.current = points;
      setUsingSample(false);
      if (points.length === 0) {
        setFileNote("The database has no crash points yet.");
        return;
      }
      setRaw(points.map((value) => value.toFixed(2)).join("\n"));
      setFileNote(`Loaded ${points.length} crash points from the database.`);
    } catch {
      setFileNote("Could not load crash points from the database. Keep this app server running.");
    } finally {
      setLoadingDatabase(false);
    }
  }

  async function studyDatabase() {
    setStudying(true);
    setFileNote("Studying every crash point in the database.");
    try {
      await saveQueue.current.catch(() => undefined);
      const points = await fetchCrashPoints();
      storedRef.current = points;
      if (points.length < 8) {
        setFileNote("The database needs at least 8 crash points before the model can be studied.");
        return;
      }
      const study = studyModel(points);
      if (!study) {
        setFileNote("The database did not produce a prediction.");
        return;
      }
      const chosen = study.fits.find((item) => item.id === study.model);
      studiedCount.current = points.length;
      setFits(study.fits);
      setUsingSample(false);
      setRaw(points.map((value) => value.toFixed(2)).join("\n"));
      setSalt(study.salt.toFixed(2));
      setModel(study.model);
      setFileNote(
        `Studied ${study.count} registered database points. ${chosen?.name ?? "The chosen model"} matched ${study.matches} of the last ${study.checked}. Next prediction is ${study.predicted.toFixed(2)}x.`,
      );
    } catch {
      setFileNote("Could not study the database. Keep this app server running.");
    } finally {
      setStudying(false);
    }
  }

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
            <Decision
              prediction={prediction}
              lastPoint={lastPoint}
              fits={fits}
              onSelectModel={setModel}
            />
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

          <label htmlFor="salt">
            Salt
            <span>Closer lead-ins when this is lower</span>
          </label>
          <input
            id="salt"
            inputMode="decimal"
            value={salt}
            onChange={(event) => setSalt(event.target.value)}
          />

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
            <button type="button" className="ghost" onClick={() => void loadDatabase()} disabled={loadingDatabase}>
              Load database
            </button>
            <button type="button" className="ghost" onClick={() => void studyDatabase()} disabled={studying}>
              Study
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
        with # are notes. New crash points are stored in the database, 200 at a time. Study reads
        every saved point and chooses the model that matched the most recent registered crashes. Pick another
        model to use that prediction instead. The next round can still land outside the range.
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
  fits,
  onSelectModel,
}: {
  prediction: ReadyPrediction;
  lastPoint: number | null;
  fits: ModelFit[];
  onSelectModel: (model: ModelId) => void;
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
          <em>{prediction.models.find((item) => item.id === prediction.model)?.name}</em>
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
        <div>
          <dt>Salt</dt>
          <dd>{prediction.salt.toFixed(2)}</dd>
        </div>
      </dl>

      <div className="model-grid" role="group" aria-label="Predict model">
        {prediction.models.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === prediction.model ? "model-option selected" : "model-option"}
            onClick={() => onSelectModel(item.id)}
          >
            <span>{item.name}</span>
            <strong>{formatMultiplier(item.predicted)}</strong>
            <small>
              {fits.find((fit) => fit.id === item.id)?.checked
                ? `${fits.find((fit) => fit.id === item.id)?.matches}/${fits.find((fit) => fit.id === item.id)?.checked} matched`
                : item.detail}
            </small>
          </button>
        ))}
      </div>

      <p className="explain">{prediction.summary}</p>

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
        {lastPoint != null ? ` Last one is ${formatMultiplier(lastPoint)}.` : ""} Load database to
        predict from every saved point, or leave the CRYGODI crash game open.
      </p>
    </div>
  );
}

function Details({ crashes, prediction }: { crashes: number[]; prediction: ReadyPrediction }) {
  const charted = crashes.slice(-72);
  const shown = crashes.slice(-48);
  const scale = Math.max(...charted.map((value) => Math.min(value, 12)), 2);

  return (
    <section className="details">
      <article className="panel">
        <header>
          <h2>Recent crashes</h2>
          <p>
            Last {charted.length} points on the bars and the line, capped at 12x so early busts stay visible. Dots in
            one column share the same range, then the next range starts a new column.
          </p>
        </header>
        <div className="chart" role="img" aria-label="Recent crash points">
          {charted.map((value, index) => (
            <div key={`${value}-${index}`} className="bar-wrap" title={formatMultiplier(value)}>
              <div
                className={`bar bar-${band(value)}`}
                style={{ height: `${(Math.min(value, 12) / scale) * 100}%` }}
              />
            </div>
          ))}
        </div>
        <RecentCrashLine values={charted} />
        <RecentCrashDots values={shown} />
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

export function RecentCrashLine({ values }: { values: number[] }) {
  const cap = 12;
  const scale = Math.max(...values.map((value) => Math.min(value, cap)), 2);
  const yOf = (value: number) => 100 - (Math.min(value, cap) / scale) * 100;
  const points = values.map((value, index) => ({
    x: values.length === 1 ? 50 : (index / (values.length - 1)) * 100,
    y: yOf(value),
    value,
  }));
  const ticks = [1, scale / 2, scale].filter(
    (tick, index, all) => tick >= 1 && all.findIndex((item) => Math.abs(item - tick) < 0.05) === index,
  );

  return (
    <div className="line-chart" role="img" aria-label={`Line chart of the last ${values.length} crash values`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {ticks.map((tick) => {
          const y = yOf(tick);
          return <line key={tick} x1="0" x2="100" y1={y} y2={y} vectorEffect="non-scaling-stroke" />;
        })}
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {ticks.map((tick) => (
        <span key={tick} className="line-label" style={{ top: `${yOf(tick)}%` }}>
          {formatMultiplier(tick)}
        </span>
      ))}
      {points.map((point, index) => (
        <span
          key={`${point.value}-${index}`}
          className={`line-dot dot-${band(point.value)}`}
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
          title={formatMultiplier(point.value)}
        />
      ))}
    </div>
  );
}

export function RecentCrashDots({ values }: { values: number[] }) {
  const columns = crashColumns(values);
  return (
    <div className="dot-block">
      <div className="dot-chart" role="list" aria-label={`Dot chart of the last ${values.length} crash values`}>
        {columns.map((column, columnIndex) => (
          <div key={columnIndex} className="dot-column" role="listitem">
            {column.map((value, index) => (
              <span key={`${value}-${index}`} className={`crash-dot crash-dot-${crashTone(value)}`} title={formatMultiplier(value)}>
                {dotLabel(value)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="dot-key">
        <span>
          <i className="swatch crash-dot-red" aria-hidden="true" />
          Under 2x
        </span>
        <span>
          <i className="swatch crash-dot-green" aria-hidden="true" />
          2x and above
        </span>
        <span>
          <i className="swatch crash-dot-moon" aria-hidden="true" />
          10x and above
        </span>
      </p>
    </div>
  );
}

const DOT_COLUMN_ROWS = 6;

function crashColumns(values: number[]): number[][] {
  const columns: number[][] = [];
  for (const value of values) {
    const tone = crashTone(value);
    const column = columns[columns.length - 1];
    if (column && crashTone(column[0]) === tone && column.length < DOT_COLUMN_ROWS) {
      column.push(value);
    } else {
      columns.push([value]);
    }
  }
  return columns;
}

function crashTone(value: number): "red" | "green" | "moon" {
  if (value >= 10) return "moon";
  if (value >= 2) return "green";
  return "red";
}

function dotLabel(value: number): string {
  if (value >= 100) return `${value.toFixed(0)}x`;
  if (value >= 10) return `${value.toFixed(1)}x`;
  return `${value.toFixed(2)}x`;
}

function band(value: number): "low" | "mid" | "high" {
  if (value < 2) return "low";
  if (value < 5) return "mid";
  return "high";
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
