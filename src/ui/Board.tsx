import { useRef, useState } from "react";
import { evidence, type EvidenceItem } from "../game/rules";
import type { CaseRecord } from "../game/state";
import { Portrait } from "./Portrait";
import { useT } from "./i18n";

const CARD_W = 210;
const BOARD_W = 1500;
const BOARD_H = 900;

interface Card {
  id: string;
  kind: "suspect" | EvidenceItem["kind"];
  suspectId?: string;
  title: string;
  text: string;
}

/**
 * The corkboard: everything found and heard as draggable cards. Pick two to tie them together
 * with red string, or to raise an objection when one is a statement.
 */
export function Board({
  record,
  onChange,
  onObject,
}: {
  record: CaseRecord;
  onChange: (r: CaseRecord) => void;
  onObject: (statementId: string, evidenceId: string) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string[]>([]);
  const [pos, setPos] = useState(record.board.pos);
  const drag = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);

  const cards: Card[] = [
    ...record.file.suspects
      .filter((s) => record.interviewed.includes(s.id) || record.found.some((id) => record.file.clues.find((c) => c.id === id)?.points_to === s.id))
      .map((s) => ({ id: `suspect:${s.id}`, kind: "suspect" as const, suspectId: s.id, title: s.name, text: s.role })),
    ...evidence(record).map((e) => ({ id: e.id, kind: e.kind, suspectId: e.suspectId, title: e.title, text: e.text })),
  ];

  // Default layout: one column per suspect (their statements, each admission right under its
  // lie), clues along the bottom. Cards the player has moved keep their position.
  const ROW = 190;
  const columns = record.file.suspects.map((s) => cards.filter((c) => c.suspectId === s.id && c.kind !== "suspect"));
  const cluesTop = 180 + Math.max(1, ...columns.map((c) => c.length)) * ROW + 20;
  const boardH = Math.max(BOARD_H, cluesTop + Math.ceil(record.found.length / 6) * 200 + 40);
  const place = (card: Card, _index: number): { x: number; y: number } => {
    if (pos[card.id]) return pos[card.id];
    const col = card.suspectId ? record.file.suspects.findIndex((s) => s.id === card.suspectId) : -1;
    if (card.kind === "suspect") return { x: 30 + col * (CARD_W + 30), y: 30 };
    if (card.kind === "clue") {
      const i = record.found.indexOf(card.id);
      return { x: 30 + (i % 6) * (CARD_W + 30), y: cluesTop + Math.floor(i / 6) * 200 };
    }
    const j = columns[col].findIndex((c) => c.id === card.id);
    return { x: 30 + col * (CARD_W + 30) + (card.kind === "truth" ? 14 : 0), y: 180 + j * ROW };
  };

  const pin = (id: string) => {
    const i = cards.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const p = place(cards[i], i);
    return { x: p.x + CARD_W / 2, y: p.y + 10 };
  };

  function down(e: React.PointerEvent, id: string, i: number) {
    const p = place(cards[i], i);
    drag.current = { id, dx: e.clientX - p.x, dy: e.clientY - p.y, sx: e.clientX, sy: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const x = Math.max(0, Math.min(BOARD_W - CARD_W, e.clientX - d.dx));
    const y = Math.max(0, Math.min(boardH - 60, e.clientY - d.dy));
    // A few pixels of jitter is still a click, not a drag.
    if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 5) return;
    d.moved = true;
    setPos((p) => ({ ...p, [d.id]: { x, y } }));
  }
  function up(id: string) {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      onChange({ ...record, board: { ...record.board, pos: { ...record.board.pos, [id]: pos[id] } }, updatedAt: Date.now() });
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  }

  const [a, b] = selected;
  const pair = a && b ? ([a, b].sort() as [string, string]) : null;
  const tied = pair && record.board.strings.some(([x, y]) => x === pair[0] && y === pair[1]);
  const statementIn = (id?: string) => cards.find((c) => c.id === id && c.kind === "statement" && !record.exposed.includes(id!));
  const target = statementIn(a) ? a : statementIn(b) ? b : undefined;
  const other = target === a ? b : a;
  const canObject = !!(target && other && !other.startsWith("suspect:"));

  function toggleString() {
    if (!pair) return;
    const strings = tied
      ? record.board.strings.filter(([x, y]) => !(x === pair[0] && y === pair[1]))
      : [...record.board.strings, pair];
    onChange({ ...record, board: { ...record.board, strings }, updatedAt: Date.now() });
    setSelected([]);
  }

  return (
    <div className="board-wrap">
      <div className="board-bar">
        <span className="muted small">{selected.length ? t("board.selected", { n: selected.length }) : t("board.help")}</span>
        <button disabled={!pair} onClick={toggleString}>
          {tied ? t("board.untie") : t("board.tie")}
        </button>
        <button className="primary objection-btn" disabled={!canObject} onClick={() => (onObject(target!, other!), setSelected([]))}>
          {t("obj.fire")}
        </button>
      </div>
      <div className="board-scroll">
        <div className="board" style={{ width: BOARD_W, height: boardH }} onPointerMove={move}>
          <svg className="strings" width={BOARD_W} height={boardH}>
            {record.board.strings.map(([x, y]) => {
              const p = pin(x);
              const q = pin(y);
              if (!p || !q) return null;
              const sag = Math.min(80, Math.hypot(q.x - p.x, q.y - p.y) / 6);
              return (
                <path
                  key={`${x}-${y}`}
                  d={`M${p.x},${p.y} Q${(p.x + q.x) / 2},${(p.y + q.y) / 2 + sag} ${q.x},${q.y}`}
                  stroke="#b3261e"
                  strokeWidth="2.5"
                  fill="none"
                />
              );
            })}
          </svg>
          {cards.map((card, i) => {
            const p = place(card, i);
            const exposed = card.kind === "statement" && record.exposed.includes(card.id);
            const suspect = card.suspectId ? record.file.suspects.find((s) => s.id === card.suspectId) : undefined;
            return (
              <div
                key={card.id}
                className={`bcard ${card.kind} ${exposed ? "exposed" : ""} ${selected.includes(card.id) ? "on" : ""}`}
                style={{ left: p.x, top: p.y, width: CARD_W }}
                onPointerDown={(e) => down(e, card.id, i)}
                onPointerUp={() => up(card.id)}
              >
                <i className="pin" />
                {card.kind === "suspect" && suspect ? (
                  <div className="bsuspect">
                    <Portrait record={record} suspect={suspect} size={56} />
                    <div>
                      <b>{card.title}</b>
                      <span className="muted small">{card.text}</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="bkind">
                      {t(`ev.${card.kind}`)}
                      {card.kind !== "clue" ? ` · ${card.title}` : ""}
                    </span>
                    {card.kind === "clue" && <b>{card.title}</b>}
                    <p>{card.kind === "clue" ? card.text : `“${card.text}”`}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
