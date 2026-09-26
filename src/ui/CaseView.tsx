import { useEffect, useRef, useState } from "react";
import { imageProvider, textProvider } from "../ai";
import type { Settings } from "../ai/types";
import { accuse, consultWatson, interrogate, interview, migrate, paint, search } from "../game/engine";
import {
  COST,
  MAX_STRIKES,
  canAct,
  cluesAt,
  composure,
  evidence,
  isDestroyed,
  isSilenced,
  nextClue,
  offCase,
  truthId,
} from "../game/rules";
import type { CaseEvent, Clue } from "../game/schema";
import type { Accusation, CaseRecord } from "../game/state";
import { recordResult } from "../store/career";
import { loadCase, saveCase } from "../store/persist";
import { Board } from "./Board";
import { useT } from "./i18n";
import { ObjectionDialog } from "./Objection";
import { Portrait } from "./Portrait";
import { Reveal } from "./Reveal";
import { Rich } from "./Rich";

type Tab = "dossier" | "scenes" | "suspects" | "board" | "notebook";
type Objecting = { statementId?: string; evidenceId?: string };

export function CaseView({ id, settings }: { id: string; settings: Settings }) {
  const t = useT();
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [tab, setTab] = useState<Tab>("dossier");
  const [talkTo, setTalkTo] = useState<string | null>(null);
  const [accusing, setAccusing] = useState(false);
  const [objecting, setObjecting] = useState<Objecting | null>(null);
  const [news, setNews] = useState<CaseEvent[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    loadCase(id).then((r) => {
      if (!r) location.hash = "#/";
      else {
        setRecord(migrate(r));
        loaded.current = true;
        document.title = `${r.file.title} · ${t("app.name")}`;
      }
    });
  }, [id, t]);

  // Persist every change.
  useEffect(() => {
    if (record && loaded.current) void saveCase(record);
    if (record?.verdict) recordResult(record);
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

  const apply = (r: CaseRecord, events: CaseEvent[] = []) => {
    setRecord(r);
    if (events.length) setNews((n) => [...n, ...events]);
  };
  const done = offCase(record);
  const tabs: Tab[] = ["dossier", "scenes", "suspects", "board", "notebook"];

  return (
    <main className="case">
      <div className="case-head">
        <div>
          <p className="kicker">{record.file.setting}</p>
          <h1>{record.file.title}</h1>
        </div>
        <div className="meters">
          <div className="clock" title={t("case.time")}>
            <div className="clock-bar">
              <div style={{ width: `${(record.time / record.timeTotal) * 100}%` }} />
            </div>
            <span>
              {t("case.time")}: <b>{t("case.hours", { n: record.time })}</b>
            </span>
          </div>
          <div className="rep" title={t("case.rep")}>
            <span className="muted small">{t("case.rep")}</span>
            <span className="stars">
              {"★".repeat(MAX_STRIKES - record.strikes)}
              <span className="lost">{"★".repeat(record.strikes)}</span>
            </span>
          </div>
        </div>
        <button className="primary accuse-btn" onClick={() => setAccusing(true)}>
          {t("case.accuse")}
        </button>
      </div>
      {done && <p className="notice urgent">{t(record.strikes >= MAX_STRIKES ? "case.offCase" : "case.outOfTime")}</p>}

      <nav className="tabs" role="tablist">
        {tabs.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`${tab === k ? "on" : ""} ${k === "notebook" ? "mobile-only" : ""}`} onClick={() => setTab(k)}>
            {t(`tab.${k}`)}
            {k === "notebook" && record.found.length > 0 && <span className="count">{record.found.length}</span>}
          </button>
        ))}
      </nav>

      {tab === "board" ? (
        <Board record={record} onChange={setRecord} onObject={(statementId, evidenceId) => setObjecting({ statementId, evidenceId })} />
      ) : (
        <div className="case-body">
          <section className="case-main">
            {tab === "dossier" && <Dossier record={record} />}
            {tab === "scenes" && <Scenes record={record} onChange={apply} />}
            {tab === "suspects" &&
              (talkTo ? (
                <Interrogation
                  key={talkTo}
                  record={record}
                  suspectId={talkTo}
                  settings={settings}
                  onChange={apply}
                  onBack={() => setTalkTo(null)}
                  onObject={(statementId) => setObjecting({ statementId })}
                />
              ) : (
                <SuspectGrid record={record} onPick={(sid) => (setTalkTo(sid), setRecord(interview(record, sid)))} />
              ))}
            {tab === "notebook" && (
              <div className="mobile-only">
                <Notebook record={record} settings={settings} onChange={apply} onObject={() => setObjecting({})} />
              </div>
            )}
          </section>
          <aside className="case-side desktop-only">
            <Notebook record={record} settings={settings} onChange={apply} onObject={() => setObjecting({})} />
          </aside>
        </div>
      )}

      {news.length > 0 && !objecting && !accusing && <NewsFlash event={news[0]} record={record} onClose={() => setNews((n) => n.slice(1))} />}
      {objecting && (
        <ObjectionDialog
          record={record}
          settings={settings}
          statementId={objecting.statementId}
          evidenceId={objecting.evidenceId}
          onResult={apply}
          onClose={() => setObjecting(null)}
        />
      )}
      {accusing && <AccuseDialog record={record} settings={settings} onDone={setRecord} onClose={() => setAccusing(false)} />}
    </main>
  );
}

function NewsFlash({ event, record, onClose }: { event: CaseEvent; record: CaseRecord; onClose: () => void }) {
  const t = useT();
  const clue = record.file.clues.find((c) => c.id === event.target);
  const where = clue && record.file.locations.find((l) => l.id === clue.location_id);
  const who = record.file.suspects.find((s) => s.id === event.target);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog news">
        <p className="kicker">{t("news.kicker", { h: event.at_hour })}</p>
        <h2>{event.title}</h2>
        <p className="prose">{event.text}</p>
        {event.effect === "reveal_clue" && where && <p className="notice">{t("news.reveal", { place: where.name })}</p>}
        {event.effect === "destroy_clue" && <p className="notice urgent">{t("news.destroy")}</p>}
        {event.effect === "silence" && who && <p className="notice urgent">{t("news.silence", { name: who.name })}</p>}
        <div className="dialog-actions">
          <button className="primary" onClick={onClose} autoFocus>
            {t("obj.continue")}
          </button>
        </div>
      </div>
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
      <div className="how card-lite">
        <h3>{t("how.title")}</h3>
        <ol>
          <li>{t("how.1", { n: COST.search })}</li>
          <li>{t("how.2")}</li>
          <li>{t("how.3", { n: MAX_STRIKES })}</li>
          <li>{t("how.4")}</li>
        </ol>
      </div>
    </div>
  );
}

function Scenes({ record, onChange }: { record: CaseRecord; onChange: (r: CaseRecord, events: CaseEvent[]) => void }) {
  const t = useT();
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <div className="scenes">
      {record.file.locations.map((loc) => {
        const found = cluesAt(record.file, loc.id).filter((c) => record.found.includes(c.id));
        const lost = cluesAt(record.file, loc.id).filter((c) => isDestroyed(record, c.id));
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
                      onChange(res.record, res.events);
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
            {lost.length > 0 && <p className="muted small">🔥 {t("scenes.lost")}</p>}
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

function Nerves({ value }: { value: number }) {
  const t = useT();
  return (
    <div className="nerves" title={t("talk.nerves")}>
      <span className="muted small">{t("talk.nerves")}</span>
      <div className="nerves-bar">
        <div style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function SuspectGrid({ record, onPick }: { record: CaseRecord; onPick: (id: string) => void }) {
  const t = useT();
  return (
    <div className="suspects">
      {record.file.suspects.map((s) => {
        const lies = s.statements.filter((st) => st.lie).length;
        const caught = s.statements.filter((st) => record.exposed.includes(st.id)).length;
        return (
          <button key={s.id} className={`suspect-card ${composure(record, s.id) === 0 ? "broken" : ""}`} onClick={() => onPick(s.id)}>
            <Portrait record={record} suspect={s} size={96} />
            <div>
              <b>{s.name}</b>
              <span className="muted small">{s.role}</span>
              {record.interviewed.includes(s.id) ? (
                <>
                  <Nerves value={composure(record, s.id)} />
                  <span className="muted small">{t("suspects.caught", { n: caught })}</span>
                </>
              ) : (
                <span className="tag-new small">{t("suspects.new")}</span>
              )}
              {isSilenced(record, s.id) && <span className="muted small">🤐 {t("talk.silenced")}</span>}
              {lies > 0 && caught === lies && <span className="small broken-label">{t("suspects.broken")}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Interrogation({
  record,
  suspectId,
  settings,
  onChange,
  onBack,
  onObject,
}: {
  record: CaseRecord;
  suspectId: string;
  settings: Settings;
  onChange: (r: CaseRecord, events: CaseEvent[]) => void;
  onBack: () => void;
  onObject: (statementId: string) => void;
}) {
  const t = useT();
  const suspect = record.file.suspects.find((s) => s.id === suspectId)!;
  const [question, setQuestion] = useState("");
  const [shown, setShown] = useState<string[]>([]);
  const [pending, setPending] = useState<{ question: string; evidence: string[]; answer: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const turns = record.talks[suspectId] ?? [];
  const items = evidence(record);
  const label = (id: string) => items.find((e) => e.id === id)?.title ?? id;
  const silenced = isSilenced(record, suspectId);

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
          onChange(step.value.record, step.value.events);
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
          <Nerves value={composure(record, suspectId)} />
        </div>
      </header>

      <section className="testimony">
        <h3>{t("talk.testimony")}</h3>
        {suspect.statements.map((st) => {
          const caught = record.exposed.includes(st.id);
          return (
            <div key={st.id} className={`statement ${caught ? "caught" : ""}`}>
              <p className="said">“{st.text}”</p>
              {caught ? (
                <p className="admitted">
                  <span className="tag cited">{t("talk.caught")}</span> {items.find((e) => e.id === truthId(st.id))?.text}
                </p>
              ) : (
                <button className="objection-btn small" disabled={!canAct(record, COST.objection)} onClick={() => onObject(st.id)}>
                  {t("obj.fire")}
                </button>
              )}
            </div>
          );
        })}
      </section>

      <h3 className="subhead">{t("talk.questions")}</h3>
      <div className="log" ref={log} aria-live="polite">
        <div className="line them">
          <p>
            <Rich text={suspect.opening_statement} />
          </p>
        </div>
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="line me">
              {turn.evidence?.map((id) => (
                <span key={id} className="chip">
                  🗂 {label(id)}
                </span>
              ))}
              <p>{turn.text}</p>
            </div>
          ) : (
            <div key={i} className="line them">
              <p>
                <Rich text={turn.text} />
              </p>
            </div>
          ),
        )}
        {pending && (
          <>
            <div className="line me">
              {pending.evidence.map((id) => (
                <span key={id} className="chip">
                  🗂 {label(id)}
                </span>
              ))}
              <p>{pending.question}</p>
            </div>
            <div className="line them typing">
              <p>
                <Rich text={pending.answer} />
                <span className="caret" />
              </p>
            </div>
          </>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {silenced ? (
        <p className="notice">🤐 {t("talk.silencedLong", { name: suspect.name })}</p>
      ) : (
        <>
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
                  {label(id)}
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
        </>
      )}
    </div>
  );
}

function Notebook({
  record,
  settings,
  onChange,
  onObject,
}: {
  record: CaseRecord;
  settings: Settings;
  onChange: (r: CaseRecord, events: CaseEvent[]) => void;
  onObject: () => void;
}) {
  const t = useT();
  const [thinking, setThinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = evidence(record);
  const testimony = items.filter((e) => e.kind !== "clue");
  const happened = record.fired.map((i) => record.file.events[i]).filter(Boolean);

  async function watson() {
    setError(null);
    setThinking("");
    try {
      const gen = consultWatson(await textProvider(settings), record);
      for (let step = await gen.next(); ; step = await gen.next()) {
        if (step.done) {
          onChange(step.value.record, step.value.events);
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
      <button className="objection-btn wide" disabled={!testimony.length || !canAct(record, COST.objection)} onClick={onObject}>
        {t("obj.fire")}
      </button>

      <h3>{t("notebook.evidence")}</h3>
      {!record.found.length && <p className="muted small">{t("notebook.noEvidence")}</p>}
      {record.found.map((id) => {
        const clue = record.file.clues.find((c) => c.id === id)!;
        return <ClueCard key={id} clue={clue} />;
      })}

      <h3>{t("notebook.testimony")}</h3>
      {!testimony.length && <p className="muted small">{t("notebook.noTestimony")}</p>}
      <ul className="pins">
        {testimony.map((e) => (
          <li key={e.id} className={`${e.kind} ${record.exposed.includes(e.id) ? "caught" : ""}`}>
            <span>
              <b>{e.title}:</b> “{e.text}”
            </span>
          </li>
        ))}
      </ul>

      {happened.length > 0 && (
        <>
          <h3>{t("notebook.events")}</h3>
          <ul className="events">
            {happened.map((e, i) => (
              <li key={i}>
                <span className="muted small">{t("case.hours", { n: e.at_hour })}</span> {e.title}
              </li>
            ))}
          </ul>
        </>
      )}

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
  const [cited, setCited] = useState<string[]>([]);
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!culprit) return;
    setJudging(true);
    setError(null);
    try {
      const accusation: Accusation = { culpritId: culprit, motive, evidence: cited };
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
            const on = cited.includes(id);
            return (
              <button
                type="button"
                key={id}
                className={`chip toggle ${on ? "on" : ""}`}
                disabled={!on && cited.length >= 3}
                onClick={() => setCited((ev) => (on ? ev.filter((x) => x !== id) : [...ev, id]))}
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
