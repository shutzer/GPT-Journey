import { useEffect, useRef, useState } from "react";
import { imageProvider, modelLabel, textProvider } from "../ai";
import type { Settings } from "../ai/types";
import { buildCase, buildPremise, newRecord, newSetup, type BuildStep } from "../game/engine";
import { coverPrompt } from "../game/prompts";
import type { Premise } from "../game/schema";
import { LANG_NATIVE, type CaseRecord, type CaseSummary, type Lang, type Mode } from "../game/state";
import { dailyTheme, hardUnlocked, loadCareer, rankOf, today } from "../store/career";
import { deleteCase, listCases, saveCase } from "../store/persist";
import { useT, type UiLang } from "./i18n";

const THEMES = ["train", "manor", "station", "festival", "jazz", "arctic"] as const;

// Preset themes are sent in English regardless of UI language; the case language decides the prose.
const THEME_TEXT: Record<string, string> = {
  train: "A night sleeper train crossing the mountains, 1936",
  manor: "A Victorian country manor during a stormy weekend party",
  station: "A research station orbiting Europa, 2189",
  festival: "The Dubrovnik summer film festival, 1972",
  jazz: "A smoky jazz club in Zagreb, 1928",
  arctic: "A snowed-in Arctic research base during the polar night",
};

interface Building {
  step: BuildStep;
  premise?: Premise;
  cover?: string;
  chars: number;
  startedAt: number;
  record?: CaseRecord;
}

export function Home({ settings, uiLang, onOpenSettings }: { settings: Settings; uiLang: UiLang; onOpenSettings: () => void }) {
  const t = useT();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [theme, setTheme] = useState<string>("train");
  const [custom, setCustom] = useState("");
  const [mode, setMode] = useState<Mode>("standard");
  const [lang, setLang] = useState<Lang>(uiLang);
  const [building, setBuilding] = useState<Building | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const career = loadCareer();
  const rank = rankOf(career);
  const day = today();
  const dailyCase = cases.find((c) => c.daily === day);

  useEffect(() => {
    listCases().then(setCases);
    document.title = `${t("app.name")} · GPT-Journey`;
  }, [t]);

  async function run(themeText: string, caseMode: Mode, daily?: string) {
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    const update = (patch: Partial<Building>) => setBuilding((b) => (b ? { ...b, ...patch } : b));
    setBuilding({ step: "premise", chars: 0, startedAt: Date.now() });
    try {
      const text = await textProvider(settings);
      const setup = newSetup(themeText, lang, caseMode, daily);
      const premise = await buildPremise(text, setup, controller.signal);
      update({ premise, step: "draft" });
      // Paint the cover while the player reads the briefing.
      const images = await imageProvider(settings);
      const cover = images?.generate(coverPrompt(premise), "wide", controller.signal).then(
        (url) => (update({ cover: url }), url),
        () => undefined,
      );
      const file = await buildCase(
        text,
        setup,
        premise,
        (step) => update({ step, chars: 0 }),
        controller.signal,
        (chars) => update({ chars }),
      );
      const record = newRecord(file, setup, modelLabel(settings), await cover);
      await saveCase(record);
      update({ step: "done", record });
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      setBuilding(null);
    }
  }

  function start(e: React.FormEvent) {
    e.preventDefault();
    const own = custom.trim();
    // With a preset selected, the text box carries extra wishes; with "custom" it is the whole theme.
    const themeText = theme === "custom" ? own : own ? `${THEME_TEXT[theme]}. Player's wishes: ${own}` : THEME_TEXT[theme];
    if (themeText) void run(themeText, mode);
  }

  const modes: Mode[] = ["quick", "standard", "hard"];

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
          <div className="field">
            <span>{t("home.mode")}</span>
            <div className="segmented">
              {modes.map((m) => {
                const locked = m === "hard" && !hardUnlocked(career);
                return (
                  <button
                    type="button"
                    key={m}
                    className={m === mode ? "on" : ""}
                    disabled={locked}
                    title={locked ? t("home.hardLocked") : t(`mode.${m}.hint`)}
                    onClick={() => setMode(m)}
                  >
                    {locked ? "🔒 " : ""}
                    {t(`mode.${m}`)}
                  </button>
                );
              })}
            </div>
            <span className="muted small">{t(`mode.${mode}.hint`)}</span>
          </div>
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
        <button className="primary big" type="submit" disabled={!!building}>
          {t("home.start")}
        </button>
      </form>

      <div className="side-col">
        <section className="card career">
          <p className="kicker">{t("career.title")}</p>
          <h2>{t(rank.key)}</h2>
          <div className="stats">
            <span>
              <b>{career.solved}</b> {t("career.solved")}
            </span>
            <span>
              <b>{career.played ? Math.round(career.totalScore / career.played) : 0}</b> {t("career.avg")}
            </span>
            <span>
              <b>{career.best}</b> {t("career.best")}
            </span>
          </div>
          {rank.next !== undefined && <p className="muted small">{t("career.next", { n: rank.next - career.solved })}</p>}
        </section>

        <section className="card daily">
          <p className="kicker">
            {t("daily.title")} · {new Date(`${day}T12:00:00`).toLocaleDateString(uiLang)}
          </p>
          <p className="daily-theme">{dailyTheme(day)}</p>
          {career.streak > 0 && <p className="muted small">🔥 {t("daily.streak", { n: career.streak })}</p>}
          {dailyCase ? (
            <a className="button" href={`#/case/${dailyCase.id}`}>
              {t(dailyCase.solved === null ? "daily.continue" : "daily.review")}
            </a>
          ) : (
            <button className="primary" disabled={!!building} onClick={() => run(dailyTheme(day), "standard", day)}>
              {t("daily.start")}
            </button>
          )}
        </section>

        <section className="card archive">
          <h2>{t("home.saved")}</h2>
          {!cases.length && <p className="muted">{t("home.empty")}</p>}
          <ul>
            {cases.map((c) => (
              <li key={c.id}>
                <a href={`#/case/${c.id}`}>
                  <strong>
                    {c.daily ? "📅 " : ""}
                    {c.title}
                  </strong>
                  <span className="muted small">
                    {t(`mode.${c.mode}`)} · {c.setting}
                  </span>
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
      </div>

      {building && (
        <div className="overlay">
          <div className={`building ${building.premise ? "reading" : ""}`}>
            {building.premise ? (
              <>
                <figure className={`cover ${building.cover ? "ready" : ""}`}>{building.cover && <img src={building.cover} alt="" />}</figure>
                <p className="kicker">{building.premise.setting}</p>
                <h2>{building.premise.title}</h2>
                <div className="prose briefing">
                  {building.premise.briefing.split(/\n{2,}/).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
                <p className="cast">
                  {building.premise.cast.map((c) => (
                    <span key={c.name}>
                      <b>{c.name}</b> · {c.role}
                    </span>
                  ))}
                </p>
              </>
            ) : (
              <div className="spinner" />
            )}
            <div className="build-foot">
              {building.record ? (
                <button className="primary big" onClick={() => (location.hash = `#/case/${building.record!.id}`)}>
                  {t("build.begin")}
                </button>
              ) : (
                <>
                  <BuildStatus building={building} />
                  <button className="ghost" onClick={() => abort.current?.abort()}>
                    {t("build.cancel")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Which step is running, elapsed time and streamed output, so a long generation visibly makes progress. */
function BuildStatus({ building }: { building: Building }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - building.startedAt) / 1000));
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const detail = building.chars ? t("build.writing", { n: building.chars.toLocaleString() }) : t("build.thinking");
  return (
    <div className="build-status">
      <div className="mini-spinner" />
      <div>
        <p>
          {t(`build.${building.step}`)} <span className="muted">· {detail} · {clock}</span>
        </p>
        <p className="muted small">{t(building.premise ? "build.readHint" : "build.hint")}</p>
      </div>
    </div>
  );
}
