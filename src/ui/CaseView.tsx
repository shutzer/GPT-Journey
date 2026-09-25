import { useEffect, useRef, useState } from "react";
import { imageProvider, textProvider } from "../ai";
import type { Settings } from "../ai/types";
import { accuse, consultWatson, interrogate, paint, search } from "../game/engine";
import { COST, canAct, cluesAt, nextClue } from "../game/rules";
import type { Clue, Suspect } from "../game/schema";
import type { Accusation, CaseRecord } from "../game/state";
import { loadCase, saveCase } from "../store/persist";
import { useT } from "./i18n";
import { Reveal } from "./Reveal";

type Tab = "dossier" | "scenes" | "suspects" | "notebook";

export function CaseView({ id, settings }: { id: string; settings: Settings }) {
  const t = useT();
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [tab, setTab] = useState<Tab>("dossier");
  const [talkTo, setTalkTo] = useState<string | null>(null);
  const [accusing, setAccusing] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    loadCase(id).then((r) => {
      if (!r) location.hash = "#/";
      else {
        setRecord(r);
        loaded.current = true;
        document.title = `${r.file.title} · ${t("app.name")}`;
      }
    });
  }, [id, t]);

  // Persist every change.
  useEffect(() => {
    if (record && loaded.current) void saveCase(record);
  }, [record]);

  // Paint whatever images are missing (new case, or a previous run was interrupted).
  useEffect(() => {
    if (!record) return;
    const controller = new AbortController();
    const onImage = (key: string, url: string) =>
      setRecord((r) =>
        r && {
          ...r,
          images: key === "cover" ? { ...r.images, cover: url } : { ...r.images, portraits: { ...r.images.portraits, [key]: url } },
        },
      );
    void (async () => {
      const images = await imageProvider(settings);
      if (images && !controller.signal.aborted) await paint(images, record, onImage, controller.signal);
    })();
    return () => controller.abort();
    // Start once per opened case (and again if the image settings change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, settings.image, settings.keys.gemini, settings.keys.openai]);

  if (!record) return <main className="case loading">{t("common.loading")}</main>;
  if (record.verdict) return <Reveal record={record} />;

  const outOfTime = !canAct(record, COST.question);
  const tabs: Tab[] = ["dossier", "scenes", "suspects", "notebook"];

  return (
    <main className="case">
      <div className="case-head">
        <div>
          <p className="kicker">{record.file.setting}</p>
          <h1>{record.file.title}</h1>
        </div>
        <div className="clock" title={t("case.time")}>
          <div className="clock-bar">
            <div style={{ width: `${(record.time / record.timeTotal) * 100}%` }} />
          </div>
          <span>
            {t("case.time")}: <b>{t("case.hours", { n: record.time })}</b>
          </span>
        </div>
        <button className="primary accuse-btn" onClick={() => setAccusing(true)}>
          {t("case.accuse")}
        </button>
      </div>
      {outOfTime && <p className="notice urgent">{t("case.outOfTime")}</p>}

      <nav className="tabs" role="tablist">
        {tabs.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`${tab === k ? "on" : ""} ${k === "notebook" ? "mobile-only" : ""}`} onClick={() => setTab(k)}>
            {t(`tab.${k}`)}
            {k === "notebook" && record.found.length > 0 && <span className="count">{record.found.length}</span>}
          </button>
        ))}
      </nav>

      <div className="case-body">
        <section className="case-main">
          {tab === "dossier" && <Dossier record={record} />}
          {tab === "scenes" && <Scenes record={record} onChange={setRecord} />}
          {tab === "suspects" &&
            (talkTo ? (
              <Interrogation key={talkTo} record={record} suspectId={talkTo} settings={settings} onChange={setRecord} onBack={() => setTalkTo(null)} />
            ) : (
              <SuspectGrid record={record} onPick={setTalkTo} />
            ))}
          {tab === "notebook" && (
            <div className="mobile-only">
              <Notebook record={record} settings={settings} onChange={setRecord} />
            </div>
          )}
        </section>
        <aside className="case-side desktop-only">
          <Notebook record={record} settings={settings} onChange={setRecord} />
        </aside>
      </div>

      {accusing && <AccuseDialog record={record} settings={settings} onDone={setRecord} onClose={() => setAccusing(false)} />}
    </main>
  );
}

export function Portrait({ record, suspect, size = 64 }: { record: CaseRecord; suspect: Suspect; size?: number }) {
  const url = record.images.portraits[suspect.id];
  const initials = suspect.name.split(/\s+/).map((w) => w[0]).slice(-2).join("");
  let hue = 0;
  for (const ch of suspect.id + suspect.name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div className="portrait" style={{ width: size, height: size, background: url ? undefined : `hsl(${hue} 30% 22%)` }}>
      {url ? <img src={url} alt={suspect.name} /> : <span style={{ fontSize: size * 0.36 }}>{initials}</span>}
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i}>{p.trim()}</p>
        ))}
    </>
  );
}

function Dossier({ record }: { record: CaseRecord }) {
  const t = useT();
  const { file } = record;
  return (
    <div className="dossier">
      <figure className={`cover ${record.images.cover ? "ready" : ""}`}>{record.images.cover && <img src={record.images.cover} alt="" />}</figure>
      <div className="briefing prose">
        <Paragraphs text={file.briefing} />
      </div>
      <div className="victim card-lite">
        <h3>{t("dossier.victim")}</h3>
        <p>
          <b>{file.victim.name}</b>. {file.victim.description}
        </p>
        <dl>
          <dt>{t("dossier.cause")}</dt>
          <dd>{file.victim.cause_of_death}</dd>
          <dt>{t("dossier.found")}</dt>
          <dd>{file.victim.found}</dd>
        </dl>
      </div>
      <p className="muted small">{t("dossier.rules", { search: COST.search, question: COST.question })}</p>
    </div>
  );
}

function Scenes({ record, onChange }: { record: CaseRecord; onChange: (r: CaseRecord) => void }) {
  const t = useT();
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <div className="scenes">
      {record.file.locations.map((loc) => {
        const found = cluesAt(record.file, loc.id).filter((c) => record.found.includes(c.id));
        const clean = !nextClue(record, loc.id);
        return (
          <article key={loc.id} className="scene card-lite">
            <header>
              <h3>{loc.name}</h3>
              {clean ? (
                <span className="muted small">{t("scenes.clean")}</span>
              ) : (
                <button
                  disabled={!canAct(record, COST.search)}
                  onClick={() => {
                    const res = search(record, loc.id);
                    if (res.clue) {
                      onChange(res.record);
                      setFlash(res.clue.id);
                    }
                  }}
                >
                  {t("scenes.search", { n: COST.search })}
                </button>
              )}
            </header>
            <p className="prose small">{loc.description}</p>
            {found.map((c) => (
              <ClueCard key={c.id} clue={c} fresh={flash === c.id} />
            ))}
          </article>
        );
      })}
    </div>
  );
}

function ClueCard({ clue, fresh = false }: { clue: Clue; fresh?: boolean }) {
  return (
    <div className={`clue ${fresh ? "fresh" : ""}`}>
      <b>{clue.title}</b>
      <p>{clue.description}</p>
    </div>
  );
}

function SuspectGrid({ record, onPick }: { record: CaseRecord; onPick: (id: string) => void }) {
  const t = useT();
  return (
    <div className="suspects">
      {record.file.suspects.map((s) => (
        <button key={s.id} className="suspect-card" onClick={() => onPick(s.id)}>
          <Portrait record={record} suspect={s} size={96} />
          <div>
            <b>{s.name}</b>
            <span className="muted small">{s.role}</span>
            <span className="muted small">{t("suspects.questions", { n: (record.talks[s.id]?.length ?? 0) / 2 })}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function Interrogation({
  record,
  suspectId,
  settings,
  onChange,
  onBack,
}: {
  record: CaseRecord;
  suspectId: string;
  settings: Settings;
  onChange: (r: CaseRecord) => void;
  onBack: () => void;
}) {
  const t = useT();
  const suspect = record.file.suspects.find((s) => s.id === suspectId)!;
  const [question, setQuestion] = useState("");
  const [shown, setShown] = useState<string[]>([]);
  const [pending, setPending] = useState<{ question: string; evidence: string[]; answer: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const turns = record.talks[suspectId] ?? [];
  const clue = (id: string) => record.file.clues.find((c) => c.id === id);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, pending?.answer]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    setPending({ question: q, evidence: shown, answer: "" });
    setQuestion("");
    try {
      const gen = interrogate(await textProvider(settings), record, suspectId, q, shown);
      for (let step = await gen.next(); ; step = await gen.next()) {
        if (step.done) {
          onChange(step.value);
          break;
        }
        const answer = step.value;
        setPending((p) => p && { ...p, answer });
      }
      setShown([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setQuestion(q);
    } finally {
      setPending(null);
    }
  }

  const quote = (text: string) => `${suspect.name}: ${text}`;
  const pinned = (text: string) => record.pins.some((p) => p.text === quote(text));
  const pin = (text: string) =>
    !pinned(text) && onChange({ ...record, pins: [...record.pins, { suspectId, text: quote(text) }], updatedAt: Date.now() });

  const Line = ({ text }: { text: string }) => (
    <div className="line them">
      <p>{text}</p>
      <button className="ghost pin" onClick={() => pin(text)} disabled={pinned(text)}>
        {pinned(text) ? t("talk.pinned") : t("talk.pin")}
      </button>
    </div>
  );

  return (
    <div className="interrogation">
      <button className="ghost back" onClick={onBack}>
        ← {t("suspects.back")}
      </button>
      <header className="talk-head">
        <Portrait record={record} suspect={suspect} size={112} />
        <div>
          <h2>{suspect.name}</h2>
          <p className="muted">{suspect.role}</p>
          <p className="small">
            <b>{t("talk.appearance")}:</b> {suspect.appearance}
          </p>
          <p className="small">
            <b>{t("talk.relation")}:</b> {suspect.relationship_to_victim}
          </p>
        </div>
      </header>

      <div className="log" ref={log} aria-live="polite">
        <Line text={suspect.opening_statement} />
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="line me">
              {turn.evidence?.map((id) => (
                <span key={id} className="chip">
                  🗂 {clue(id)?.title}
                </span>
              ))}
              <p>{turn.text}</p>
            </div>
          ) : (
            <Line key={i} text={turn.text} />
          ),
        )}
        {pending && (
          <>
            <div className="line me">
              {pending.evidence.map((id) => (
                <span key={id} className="chip">
                  🗂 {clue(id)?.title}
                </span>
              ))}
              <p>{pending.question}</p>
            </div>
            <div className="line them typing">
              <p>
                {pending.answer}
                <span className="caret" />
              </p>
            </div>
          </>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {record.found.length > 0 && (
        <div className="evidence-picker">
          <span className="muted small">{t("talk.show")}:</span>
          {record.found.map((id) => (
            <button
              key={id}
              type="button"
              className={`chip toggle ${shown.includes(id) ? "on" : ""}`}
              onClick={() => setShown((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            >
              {clue(id)?.title}
            </button>
          ))}
        </div>
      )}
      <form className="ask" onSubmit={ask}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("talk.placeholder", { name: suspect.name })}
          maxLength={500}
          disabled={!!pending || !canAct(record, COST.question)}
        />
        <button className="primary" disabled={!!pending || !question.trim() || !canAct(record, COST.question)}>
          {t("talk.ask", { n: COST.question })}
        </button>
      </form>
    </div>
  );
}

function Notebook({ record, settings, onChange }: { record: CaseRecord; settings: Settings; onChange: (r: CaseRecord) => void }) {
  const t = useT();
  const [thinking, setThinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function watson() {
    setError(null);
    setThinking("");
    try {
      const gen = consultWatson(await textProvider(settings), record);
      for (let step = await gen.next(); ; step = await gen.next()) {
        if (step.done) {
          onChange(step.value);
          break;
        }
        setThinking(step.value);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setThinking(null);
    }
  }

  return (
    <div className="notebook">
      <h3>{t("notebook.evidence")}</h3>
      {!record.found.length && <p className="muted small">{t("notebook.noEvidence")}</p>}
      {record.found.map((id) => {
        const clue = record.file.clues.find((c) => c.id === id)!;
        return <ClueCard key={id} clue={clue} />;
      })}

      <h3>{t("notebook.pins")}</h3>
      {!record.pins.length && <p className="muted small">{t("notebook.noPins")}</p>}
      <ul className="pins">
        {record.pins.map((p, i) => (
          <li key={i}>
            <span>“{p.text}”</span>
            <button className="ghost icon" aria-label={t("notebook.unpin")} onClick={() => onChange({ ...record, pins: record.pins.filter((_, j) => j !== i), updatedAt: Date.now() })}>
              ×
            </button>
          </li>
        ))}
      </ul>

      <h3>{t("notebook.watson")}</h3>
      {record.watson.map((note, i) => (
        <blockquote key={i} className="watson">
          {note}
        </blockquote>
      ))}
      {thinking !== null && (
        <blockquote className="watson">
          {thinking}
          <span className="caret" />
        </blockquote>
      )}
      {error && <p className="error">{error}</p>}
      <button onClick={watson} disabled={thinking !== null || !canAct(record, COST.watson)}>
        {t("notebook.askWatson", { n: COST.watson })}
      </button>
    </div>
  );
}

function AccuseDialog({
  record,
  settings,
  onDone,
  onClose,
}: {
  record: CaseRecord;
  settings: Settings;
  onDone: (r: CaseRecord) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [culprit, setCulprit] = useState<string | null>(null);
  const [motive, setMotive] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!culprit) return;
    setJudging(true);
    setError(null);
    try {
      const accusation: Accusation = { culpritId: culprit, motive, evidence };
      onDone(await accuse(await textProvider(settings), record, accusation));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setJudging(false);
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !judging && onClose()}>
      <form className="dialog accuse" onSubmit={submit}>
        <h2>{t("accuse.title")}</h2>
        <h3>{t("accuse.who")}</h3>
        <div className="pick-suspect">
          {record.file.suspects.map((s) => (
            <label key={s.id} className={culprit === s.id ? "on" : ""}>
              <input type="radio" name="culprit" value={s.id} checked={culprit === s.id} onChange={() => setCulprit(s.id)} />
              <Portrait record={record} suspect={s} size={72} />
              <span>{s.name}</span>
            </label>
          ))}
        </div>
        <h3>{t("accuse.motive")}</h3>
        <textarea rows={3} value={motive} onChange={(e) => setMotive(e.target.value)} placeholder={t("accuse.motivePlaceholder")} maxLength={600} />
        <h3>{t("accuse.evidence")}</h3>
        {!record.found.length && <p className="muted small">{t("notebook.noEvidence")}</p>}
        <div className="evidence-picker">
          {record.found.map((id) => {
            const on = evidence.includes(id);
            return (
              <button
                type="button"
                key={id}
                className={`chip toggle ${on ? "on" : ""}`}
                disabled={!on && evidence.length >= 3}
                onClick={() => setEvidence((ev) => (on ? ev.filter((x) => x !== id) : [...ev, id]))}
              >
                {record.file.clues.find((c) => c.id === id)?.title}
              </button>
            );
          })}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          {judging ? (
            <span className="muted">{t("accuse.judging")}</span>
          ) : (
            <>
              <button type="button" className="ghost" onClick={onClose}>
                {t("accuse.cancel")}
              </button>
              <button className="primary" disabled={!culprit}>
                {t("accuse.submit")}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
