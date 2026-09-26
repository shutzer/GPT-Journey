import type { CaseRecord } from "../game/state";

const KEY = "caseFiles.career";

export interface Career {
  played: number;
  solved: number;
  totalScore: number;
  best: number;
  /** Consecutive days with a solved daily case. */
  streak: number;
  lastDaily?: string;
  /** Case ids already counted, so reopening a finished case doesn't count twice. */
  counted: string[];
}

const EMPTY: Career = { played: 0, solved: 0, totalScore: 0, best: 0, streak: 0, counted: [] };

export function loadCareer(): Career {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? "null") };
  } catch {
    return { ...EMPTY };
  }
}

export function recordResult(r: CaseRecord): Career {
  const c = loadCareer();
  if (!r.verdict || c.counted.includes(r.id)) return c;
  const next: Career = {
    ...c,
    played: c.played + 1,
    solved: c.solved + (r.verdict.correct ? 1 : 0),
    totalScore: c.totalScore + r.verdict.score,
    best: Math.max(c.best, r.verdict.score),
    counted: [...c.counted, r.id].slice(-500),
  };
  const day = r.setup.daily;
  if (day && r.verdict.correct && c.lastDaily !== day) {
    next.streak = c.lastDaily === previousDay(day) ? c.streak + 1 : 1;
    next.lastDaily = day;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export const RANKS: Array<[number, string]> = [
  [0, "career.r0"],
  [1, "career.r1"],
  [3, "career.r2"],
  [6, "career.r3"],
  [10, "career.r4"],
  [20, "career.r5"],
];

export function rankOf(c: Career): { key: string; next?: number } {
  let i = 0;
  while (i + 1 < RANKS.length && c.solved >= RANKS[i + 1][0]) i++;
  return { key: RANKS[i][1], next: RANKS[i + 1]?.[0] };
}

/** Hard cases unlock after the first solved case. */
export const hardUnlocked = (c: Career) => c.solved >= 1;

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function previousDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAILY_SETTINGS = [
  "a lighthouse on a storm-cut Adriatic island, 1958",
  "a Venetian mask-maker's workshop during Carnival, 1790",
  "a Zeppelin crossing the Atlantic, 1936",
  "a monastery vineyard at harvest, Dalmatia, 1911",
  "a luxury ski chalet cut off by an avalanche, 1987",
  "a travelling circus wintering in Slavonia, 1925",
  "a film set on the Brijuni islands, 1964",
  "a chess tournament in a Budapest hotel, 1948",
  "a deep-sea research habitat, 2061",
  "an opera premiere in Zagreb's national theatre, 1895",
  "a truffle hunters' guild dinner in Istria, 1972",
  "a Martian greenhouse colony during a dust storm, 2140",
  "a royal hunting lodge in the Carpathians, 1903",
  "a riverboat casino on the Danube, 1929",
  "a museum night gala before a heist exhibition, 2019",
  "a sanatorium in the Alps, 1912",
  "a pirate-radio ship anchored off the coast, 1966",
  "a Silk Road caravanserai, 1340",
  "a perfume house in Grasse on launch night, 1953",
  "a snowed-in mountain observatory, 1978",
];

const DAILY_TWISTS = [
  "the victim was not who everyone thought",
  "two suspects share an alibi and both are lying",
  "the murder weapon was hidden in plain sight",
  "the time of death is not what it seems",
  "a locked room",
  "the detective's first informant is involved",
  "the killer tried to frame someone else",
];

/** Same setting and twist for everyone on a given day; the case itself is written fresh. */
export function dailyTheme(iso: string): string {
  const n = Math.floor(new Date(`${iso}T12:00:00Z`).getTime() / 86_400_000);
  return `${DAILY_SETTINGS[n % DAILY_SETTINGS.length]}. Twist: ${DAILY_TWISTS[n % DAILY_TWISTS.length]}`;
}
