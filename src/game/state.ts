import type { CaseFile, MotiveGrade } from "./schema";

export type Lang = "en" | "hr" | "de" | "es" | "fr" | "it";

export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  hr: "Croatian",
  de: "German",
  es: "Spanish",
  fr: "French",
  it: "Italian",
};

/** How each language names itself, for pickers. */
export const LANG_NATIVE: Record<Lang, string> = {
  en: "English",
  hr: "Hrvatski",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
};

export type Mode = "quick" | "standard" | "hard";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Evidence ids the detective laid on the table with this question. */
  evidence?: string[];
}

export interface Accusation {
  culpritId: string;
  motive: string;
  evidence: string[];
}

export interface Verdict {
  correct: boolean;
  score: number;
  rank: string;
  motive: MotiveGrade;
  keyFound: number;
  keyTotal: number;
  keyCited: number;
  liesExposed: number;
  liesTotal: number;
  strikes: number;
  confessed: boolean;
}

export interface CaseSetup {
  theme: string;
  lang: Lang;
  mode: Mode;
  /** Suspect count; derived from the mode for new cases. */
  suspects: number;
  /** ISO date when this is the daily case. */
  daily?: string;
}

export interface BoardState {
  pos: Record<string, { x: number; y: number }>;
  strings: Array<[string, string]>;
}

export interface CaseRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  setup: CaseSetup;
  model: string;
  file: CaseFile;
  images: { cover?: string; portraits: Record<string, string> };
  time: number;
  timeTotal: number;
  /** Clue ids in the order they were found. */
  found: string[];
  /** Suspects whose formal testimony has been taken. */
  interviewed: string[];
  /** Lie statement ids the detective has exposed. */
  exposed: string[];
  /** Failed objections. Three and the detective is taken off the case. */
  strikes: number;
  /** Indexes into file.events that have happened. */
  fired: number[];
  talks: Record<string, ChatTurn[]>;
  watson: string[];
  board: BoardState;
  accusation?: Accusation;
  verdict?: Verdict;
}

export interface CaseSummary {
  id: string;
  title: string;
  setting: string;
  updatedAt: number;
  solved: boolean | null;
  lang: Lang;
  mode: Mode;
  daily?: string;
}

export function summarize(c: CaseRecord): CaseSummary {
  return {
    id: c.id,
    title: c.file.title,
    setting: c.file.setting,
    updatedAt: c.updatedAt,
    solved: c.verdict ? c.verdict.correct : null,
    lang: c.setup.lang,
    mode: c.setup.mode ?? "standard",
    daily: c.setup.daily,
  };
}
