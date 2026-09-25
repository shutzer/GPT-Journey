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

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Clue ids the detective laid on the table with this question. */
  evidence?: string[];
}

export interface Pin {
  suspectId: string;
  text: string;
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
}

export interface CaseSetup {
  theme: string;
  suspects: number;
  lang: Lang;
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
  talks: Record<string, ChatTurn[]>;
  pins: Pin[];
  watson: string[];
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
}

export function summarize(c: CaseRecord): CaseSummary {
  return {
    id: c.id,
    title: c.file.title,
    setting: c.file.setting,
    updatedAt: c.updatedAt,
    solved: c.verdict ? c.verdict.correct : null,
    lang: c.setup.lang,
  };
}
