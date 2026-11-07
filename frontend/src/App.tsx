import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { enhance, type EnhanceResponse, type Style } from "./api";

const MAX_CHARS = 2000;
const EXAMPLES = [
  "develop a cafe website",
  "develop a website for railway ticket booking",
  "online store for handmade candles with stripe checkout",
];

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("detailed");
  const [usePrevious, setUsePrevious] = useState(false);
  const [previousPlan, setPreviousPlan] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnhanceResponse | null>(null);
  const [changeRequest, setChangeRequest] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => void (timer.current && window.clearInterval(timer.current)), []);

  const tooLong = prompt.length > MAX_CHARS;
  const canSubmit = !loading && prompt.trim().length > 0 && !tooLong;

  async function run(text: string, prev: string | null) {
    setLoading(true);
    setError(null);
    setCopied(false);
    setElapsed(0);
    const t0 = Date.now();
    timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    try {
      const r = await enhance({ prompt: text, style, previousPlan: prev });
      setResult(r);
      setPreviousPlan(r.enhanced);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (timer.current) window.clearInterval(timer.current);
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    run(prompt.trim(), usePrevious && previousPlan.trim() ? previousPlan : null);
  }

  function onChangeRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!result || !changeRequest.trim() || loading) return;
    setPrompt(changeRequest.trim());
    run(changeRequest.trim(), result.enhanced);
    setChangeRequest("");
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.enhanced);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = result.enhanced;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Prompt Enhancer</h1>
          <p className="sub">Turn a rough website idea into an implementation-ready 12-section plan for an AI website builder.</p>
        </div>
        {result?.meta && (
          <span className="badge" title="AI provider and model used by the backend">
            {result.meta.provider} · {result.meta.model}
          </span>
        )}
      </header>

      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="prompt" className="label">
          Your idea
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='e.g. "develop a cafe website"'
          rows={4}
          aria-describedby="counter"
        />
        <div className="row between">
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button type="button" key={ex} className="chip" onClick={() => setPrompt(ex)} disabled={loading}>
                {ex}
              </button>
            ))}
          </div>
          <span id="counter" className={`counter ${tooLong ? "over" : ""}`}>
            {prompt.length} / {MAX_CHARS}
          </span>
        </div>

        <details className="prev" open={usePrevious}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setUsePrevious((v) => !v);
            }}
          >
            <input type="checkbox" checked={usePrevious} readOnly tabIndex={-1} /> Send as a change request to a previous plan (optional)
          </summary>
          <textarea
            value={previousPlan}
            onChange={(e) => setPreviousPlan(e.target.value)}
            placeholder="Paste a previous plan here, or run the enhancer once and it is filled in for you."
            rows={6}
          />
        </details>

        <div className="row between">
          <label className="inline">
            Style
            <select value={style} onChange={(e) => setStyle(e.target.value as Style)} disabled={loading}>
              <option value="short">short</option>
              <option value="detailed">detailed</option>
              <option value="technical">technical</option>
            </select>
          </label>
          <button type="submit" className="primary" disabled={!canSubmit}>
            {loading ? "Enhancing…" : "Enhance"}
          </button>
        </div>
      </form>

      {loading && (
        <div className="card loading" role="status">
          <span className="spinner" aria-hidden />
          The agent is working: analyze_prompt → get_template → draft → score_prompt … <span className="muted">{elapsed}s</span>
        </div>
      )}

      {error && (
        <div className="card error" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && !loading && (
        <>
          <div className="summary">
            <div className="score" aria-label={`Score before ${result.score.before}, after ${result.score.after}`}>
              <span className="before">{result.score.before}</span>
              <span className="arrow">→</span>
              <span className="after">{result.score.after}</span>
              <span className="muted">/ 10</span>
            </div>
            <span className="muted">
              {result.steps.length} agent steps
              {result.meta ? ` · ${(result.meta.durationMs / 1000).toFixed(1)}s · ${result.meta.style}${result.meta.mode === "update" ? " · update" : ""}` : ""}
            </span>
            {result.warning && <span className="warning">⚠ {result.warning}</span>}
          </div>

          <div className="columns">
            <section className="card col-original">
              <h2>Original</h2>
              <pre className="original">{result.original}</pre>
            </section>
            <section className="card col-enhanced">
              <div className="row between">
                <h2>Enhanced plan</h2>
                <button type="button" onClick={copy} className="secondary">
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <article className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.enhanced}</ReactMarkdown>
              </article>
            </section>
          </div>

          <div className="columns two">
            <section className="card">
              <h2>Clarifying questions</h2>
              {result.questions.length ? (
                <ol>
                  {result.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              ) : (
                <p className="muted">No blocking questions.</p>
              )}
            </section>
            <section className="card">
              <h2>Assumptions</h2>
              {result.assumptions.length ? (
                <ul>
                  {result.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No assumptions.</p>
              )}
            </section>
          </div>

          {result.changes.length > 0 && (
            <section className="card">
              <h2>What changed</h2>
              <ul>
                {result.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </section>
          )}

          <form className="card" onSubmit={onChangeRequest}>
            <label htmlFor="change" className="label">
              Request a change to this plan
            </label>
            <div className="row">
              <input
                id="change"
                value={changeRequest}
                maxLength={MAX_CHARS}
                onChange={(e) => setChangeRequest(e.target.value)}
                placeholder='e.g. "add online food ordering"'
              />
              <button type="submit" className="primary" disabled={!changeRequest.trim() || loading}>
                Update plan
              </button>
            </div>
          </form>

          <details className="card steps" open>
            <summary>
              <h2>Agent steps ({result.steps.length})</h2>
            </summary>
            <ol className="step-list">
              {result.steps.map((s) => (
                <li key={s.step}>
                  <details>
                    <summary>
                      <span className="step-no">{s.step}</span>
                      <code>{s.tool}</code>
                      <span className={s.ok ? "ok" : "fail"}>{s.ok ? "ok" : "error"}</span>
                      <span className="muted">{s.durationMs} ms</span>
                      {s.tool === "score_prompt" && s.ok && <span className="muted">score {(s.output as { score: number }).score}/10</span>}
                    </summary>
                    <div className="io">
                      <div>
                        <h3>Input</h3>
                        <pre>{JSON.stringify(s.input, null, 2)}</pre>
                      </div>
                      <div>
                        <h3>Output</h3>
                        <pre>{JSON.stringify(s.output, null, 2)}</pre>
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}

      <footer className="muted">The browser talks only to the Express backend. The AI key never leaves the server.</footer>
    </div>
  );
}
