import { useEffect, useRef, useState } from "react";
import { modelLabel, textProvider } from "../ai";
import type { Settings } from "../ai/types";
import { buildCase, newRecord, type BuildStep } from "../game/engine";
import { LANG_NATIVE, type CaseSummary, type Lang } from "../game/state";
import { deleteCase, listCases, saveCase } from "../store/persist";
import { useT, type UiLang } from "./i18n";

const THEMES = ["train", "manor", "station", "festival", "jazz", "arctic"] as const;

export function Home({ settings, uiLang, onOpenSettings }: { settings: Settings; uiLang: UiLang; onOpenSettings: () => void }) {
  const t = useT();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [theme, setTheme] = useState<string>("train");
  const [custom, setCustom] = useState("");
  const [suspects, setSuspects] = useState(4);
  const [lang, setLang] = useState<Lang>(uiLang);
  const [step, setStep] = useState<BuildStep | null>(null);
  const [chars, setChars] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    listCases().then(setCases);
    document.title = `${t("app.name")} · GPT-Journey`;
  }, [t]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const own = custom.trim();
    // With a preset selected, the text box carries extra wishes; with "custom" it is the whole theme.
    const themeText = theme === "custom" ? own : own ? `${translate(theme)}. Player's wishes: ${own}` : translate(theme);
    if (!themeText) return;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const text = await textProvider(settings);
      const setup = { theme: themeText, suspects, lang };
      setStep("draft");
      setChars(0);
      setStartedAt(Date.now());
      const file = await buildCase(text, setup, (st) => {
        setStep(st);
        setChars(0);
      }, controller.signal, setChars);
      const record = newRecord(file, setup, modelLabel(settings));
      await saveCase(record);
      location.hash = `#/case/${record.id}`;
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStep(null);
    }
  }

  // Preset themes are generated in English regardless of UI language; the case language decides the prose.
  const translate = (key: string) => {
    const en: Record<string, string> = {
      train: "A night sleeper train crossing the mountains, 1936",
      manor: "A Victorian country manor during a stormy weekend party",
      station: "A research station orbiting Europa, 2189",
      festival: "The Dubrovnik summer film festival, 1972",
      jazz: "A smoky jazz club in Zagreb, 1928",
      arctic: "A snowed-in Arctic research base during the polar night",
    };
    return en[key] ?? key;
  };

  return (
    <main className="home">
      <section className="intro">
        <h1>{t("app.name")}</h1>
        <p>{t("app.tagline")}</p>
      </section>

      <form className="card new-case" onSubmit={start}>
        <h2>{t("home.new")}</h2>
        {settings.text === "demo" && (
          <p className="notice">
            {t("home.demo")}{" "}
            <button type="button" className="link" onClick={onOpenSettings}>
              {t("nav.settings")} →
            </button>
          </p>
        )}
        <fieldset className="themes">
          <legend>{t("home.theme")}</legend>
          {["custom", ...THEMES].map((key) => (
            <label key={key} className={`theme theme-${key}`}>
              <input type="radio" name="theme" value={key} checked={theme === key} onChange={() => setTheme(key)} />
              <span>{key === "custom" ? `✍️ ${t("home.custom")}` : t(`theme.${key}`)}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>{t(theme === "custom" ? "home.customLabel" : "home.wishesLabel")}</span>
          <textarea
            rows={3}
            value={custom}
            maxLength={600}
            required={theme === "custom"}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={t(theme === "custom" ? "home.customPlaceholder" : "home.wishesPlaceholder")}
          />
        </label>
        <div className="row">
          <label className="field">
            <span>{t("home.suspects")}</span>
            <div className="segmented">
              {[3, 4, 5].map((n) => (
                <button type="button" key={n} className={n === suspects ? "on" : ""} onClick={() => setSuspects(n)}>
                  {n}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            <span>{t("home.lang")}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {Object.entries(LANG_NATIVE).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary big" type="submit" disabled={!!step}>
          {t("home.start")}
        </button>
      </form>

      <section className="card archive">
        <h2>{t("home.saved")}</h2>
        {!cases.length && <p className="muted">{t("home.empty")}</p>}
        <ul>
          {cases.map((c) => (
            <li key={c.id}>
              <a href={`#/case/${c.id}`}>
                <strong>{c.title}</strong>
                <span className="muted small">{c.setting}</span>
              </a>
              <span className={`stamp ${c.solved === null ? "open" : c.solved ? "solved" : "failed"}`}>
                {t(c.solved === null ? "home.open" : c.solved ? "home.solved" : "home.failed")}
              </span>
              <button
                className="ghost icon"
                aria-label={t("home.delete")}
                onClick={async () => {
                  if (!confirm(t("home.confirmDelete"))) return;
                  await deleteCase(c.id);
                  setCases(await listCases());
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>

      {step && (
        <div className="overlay">
          <div className="building">
            <div className="spinner" />
            <ol>
              {(["draft", "audit", "done"] as const).map((s) => (
                <li key={s} className={stepState(step, s)}>
                  {t(s === "draft" && step === "repair" ? "build.repair" : `build.${s}`)}
                </li>
              ))}
            </ol>
            <BuildStatus chars={chars} startedAt={startedAt} />
            <button className="ghost" onClick={() => abort.current?.abort()}>
              {t("build.cancel")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/** Elapsed time and streamed output, so a long generation visibly makes progress. */
function BuildStatus({ chars, startedAt }: { chars: number; startedAt: number }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className="build-status">
      <p>{chars ? t("build.writing", { n: chars.toLocaleString() }) : t("build.thinking")} · {clock}</p>
      <p className="muted small">{t("build.hint")}</p>
    </div>
  );
}

function stepState(current: BuildStep, s: "draft" | "audit" | "done"): string {
  const order = { draft: 0, repair: 0, audit: 1, done: 2 };
  return order[current] > order[s] ? "done" : order[current] === order[s] ? "active" : "";
}
