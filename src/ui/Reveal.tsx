import type { CaseRecord } from "../game/state";
import { Portrait } from "./CaseView";
import { useT } from "./i18n";

export function Reveal({ record }: { record: CaseRecord }) {
  const t = useT();
  const { file, verdict, accusation } = record;
  if (!verdict || !accusation) return null;
  const culprit = file.suspects.find((s) => s.id === file.solution.culprit_id)!;
  const accused = file.suspects.find((s) => s.id === accusation.culpritId);

  return (
    <main className="reveal">
      <section className={`verdict ${verdict.correct ? "win" : "lose"}`}>
        <p className="kicker">{file.title}</p>
        <h1>{t(verdict.correct ? "reveal.correct" : "reveal.wrong")}</h1>
        <div className="score">
          <span className="big-num">{verdict.score}</span>
          <span>
            {t("reveal.score")} · <b>{t(verdict.rank)}</b>
          </span>
        </div>
        <p className="muted">{t("reveal.keyStats", { found: verdict.keyFound, total: verdict.keyTotal, cited: verdict.keyCited })}</p>
        {verdict.motive.comment && <p className="motive-comment">“{verdict.motive.comment}”</p>}
        {!verdict.correct && accused && <p className="muted">↳ {accused.name}</p>}
      </section>

      <section className="card-lite culprit">
        <Portrait record={record} suspect={culprit} size={120} />
        <div>
          <p className="kicker">{t("reveal.culprit")}</p>
          <h2>{culprit.name}</h2>
          <dl>
            <dt>{t("reveal.motive")}</dt>
            <dd>{file.solution.motive}</dd>
            <dt>{t("reveal.method")}</dt>
            <dd>{file.solution.method}</dd>
            <dt>{t("reveal.opportunity")}</dt>
            <dd>{file.solution.opportunity}</dd>
          </dl>
        </div>
      </section>

      <section className="prose explanation">
        {file.solution.explanation.split(/\n{2,}/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </section>

      <section>
        <h2>{t("reveal.keyClues")}</h2>
        <ul className="key-clues">
          {file.solution.key_clue_ids.map((id) => {
            const clue = file.clues.find((c) => c.id === id)!;
            const found = record.found.includes(id);
            return (
              <li key={id} className={found ? "found" : "missed"}>
                <b>{clue.title}</b>{" "}
                <span className="tag">{t(found ? "reveal.found" : "reveal.missed")}</span>
                {accusation.evidence.includes(id) && <span className="tag cited">{t("reveal.cited")}</span>}
                <p>{clue.significance}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>{t("reveal.timeline")}</h2>
        <ol className="timeline">
          {file.timeline.map((e, i) => (
            <li key={i}>
              <time>{e.time}</time>
              <span>{e.event}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>{t("reveal.secrets")}</h2>
        <div className="secrets">
          {file.suspects.map((s) => (
            <article key={s.id} className="card-lite">
              <header>
                <Portrait record={record} suspect={s} size={48} />
                <b>{s.name}</b>
              </header>
              <p>{s.secret}</p>
              <p className="muted small">
                {t("reveal.lies")}: {s.lies.join(" · ")}
              </p>
            </article>
          ))}
        </div>
      </section>

      <a className="button primary" href="#/">
        {t("reveal.back")}
      </a>
    </main>
  );
}
