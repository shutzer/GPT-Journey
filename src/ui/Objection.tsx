import { useState } from "react";
import { textProvider } from "../ai";
import type { Settings } from "../ai/types";
import { object, react } from "../game/engine";
import { COST, MAX_STRIKES, allStatements, evidence, type EvidenceItem } from "../game/rules";
import type { CaseEvent } from "../game/schema";
import type { CaseRecord } from "../game/state";
import { useT } from "./i18n";
import { Rich } from "./Rich";

type Phase = { kind: "pick" } | { kind: "shout" } | { kind: "hit"; text: string; done: boolean } | { kind: "miss" };

/**
 * Challenge a statement with a piece of evidence. On a hit the suspect's actor plays the moment
 * of being caught; on a miss the detective loses credibility and time.
 */
export function ObjectionDialog({
  record,
  settings,
  statementId,
  evidenceId,
  onResult,
  onClose,
}: {
  record: CaseRecord;
  settings: Settings;
  statementId?: string;
  evidenceId?: string;
  onResult: (r: CaseRecord, events: CaseEvent[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const items = evidence(record);
  const [target, setTarget] = useState<string | undefined>(statementId);
  const [proof, setProof] = useState<string | undefined>(evidenceId);
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const statement = allStatements(record.file).find((s) => s.id === target);
  const owner = record.file.suspects.find((s) => s.statements.some((st) => st.id === target));
  const challengeable = items.filter((i) => i.kind === "statement" && !record.exposed.includes(i.id));
  const proofs = items.filter((i) => i.id !== target && i.suspectId !== owner?.id);
  const ownProofs = items.filter((i) => i.id !== target && i.suspectId === owner?.id && i.kind === "truth");

  async function fire() {
    if (!target || !proof) return;
    setError(null);
    let result;
    try {
      result = object(record, target, proof);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setPhase({ kind: "shout" });
    await new Promise((r) => setTimeout(r, 900));
    if (!result.success) {
      setPhase({ kind: "miss" });
      onResult(result.record, result.events);
      return;
    }
    setPhase({ kind: "hit", text: "", done: false });
    try {
      const gen = react(await textProvider(settings), record, target, proof);
      for (let step = await gen.next(); ; step = await gen.next()) {
        if (step.done) {
          setPhase({ kind: "hit", text: step.value, done: true });
          break;
        }
        const text = step.value;
        setPhase({ kind: "hit", text, done: false });
      }
    } catch {
      setPhase({ kind: "hit", text: statement?.admission ?? "", done: true });
    }
    onResult(result.record, result.events);
  }

  const Option = ({ item, selected, onPick }: { item: EvidenceItem; selected: boolean; onPick: () => void }) => (
    <button type="button" className={`ev-option ${item.kind} ${selected ? "on" : ""}`} onClick={onPick}>
      <span className="ev-kind">{t(`ev.${item.kind}`)}{item.kind !== "clue" ? ` · ${item.title}` : ""}</span>
      <span>{item.kind === "clue" ? <b>{item.title}. </b> : null}{item.kind === "clue" ? item.text : `“${item.text}”`}</span>
    </button>
  );

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && phase.kind === "pick" && onClose()}>
      <div className="dialog objection">
        {phase.kind === "pick" && (
          <>
            <h2>{t("obj.title")}</h2>
            <p className="muted small">{t("obj.help", { cost: COST.objection, miss: COST.objectionMiss, strikes: MAX_STRIKES - record.strikes })}</p>
            <h3>{t("obj.which")}</h3>
            <div className="ev-list">
              {(statement ? [items.find((i) => i.id === target)!] : challengeable).map((item) => (
                <Option key={item.id} item={item} selected={item.id === target} onPick={() => setTarget(item.id === target ? undefined : item.id)} />
              ))}
            </div>
            {statement && (
              <>
                <h3>{t("obj.with")}</h3>
                <div className="ev-list">
                  {[...proofs, ...ownProofs].map((item) => (
                    <Option key={item.id} item={item} selected={item.id === proof} onPick={() => setProof(item.id)} />
                  ))}
                  {!proofs.length && !ownProofs.length && <p className="muted small">{t("obj.nothing")}</p>}
                </div>
              </>
            )}
            {error && <p className="error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={onClose}>
                {t("accuse.cancel")}
              </button>
              <button className="primary objection-btn" disabled={!target || !proof} onClick={fire}>
                {t("obj.fire")}
              </button>
            </div>
          </>
        )}
        {phase.kind === "shout" && <div className="shout">{t("obj.shout")}</div>}
        {phase.kind === "hit" && (
          <>
            <div className="shout small hit">{t("obj.hit")}</div>
            <p className="kicker">{owner?.name}</p>
            <p className="prose reaction">
              <Rich text={phase.text} />
              {!phase.done && <span className="caret" />}
            </p>
            <div className="dialog-actions">
              <button className="primary" disabled={!phase.done} onClick={onClose}>
                {t("obj.continue")}
              </button>
            </div>
          </>
        )}
        {phase.kind === "miss" && (
          <>
            <div className="shout small miss">{t("obj.miss")}</div>
            <p className="prose">{t("obj.missText", { name: owner?.name ?? "" })}</p>
            <p className="strikes-big">{"★".repeat(MAX_STRIKES - record.strikes - 1)}{"☆".repeat(record.strikes + 1)}</p>
            <div className="dialog-actions">
              <button className="primary" onClick={onClose}>
                {t("obj.continue")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
