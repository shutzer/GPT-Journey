import { MODES } from "./rules";
import type { CaseFile, Clue, Premise, Statement, Suspect } from "./schema";
import { LANG_NAMES, type CaseSetup, type ChatTurn, type Lang } from "./state";

export const PREMISE_SYSTEM = `\
You set up murder mysteries for an interactive detective game. Write only the opening: the \
setting, the victim, the cast of suspects and the briefing the detective reads on arrival. \
Hook the reader in the first sentence. Keep it suitable for a general audience: no graphic gore. \
All prose and names in the requested language.`;

export function premisePrompt(setup: CaseSetup): string {
  return `Set up a new murder mystery.

Theme / setting: ${setup.theme}
Number of suspects: exactly ${setup.suspects}
Language: ${LANG_NAMES[setup.lang]}

Make it original, with room for a memorable, fair twist.`;
}

export const ARCHITECT_SYSTEM = `\
You are a master mystery writer designing a fair-play whodunit for an interactive detective game. \
The game works like this:
- The player searches locations; each search reveals one clue.
- Each suspect gives formal testimony: a list of statements. The player wins by OBJECTING: \
presenting a clue, another statement, or an earlier admission that proves a statement false. \
A caught lie makes the suspect admit something (the "admission"), and that admission becomes new \
evidence with the id "<lie id>_truth", usable against other statements.
- Suspects are played by separate AI actors that only know their own character sheet.
- Events happen at set hours while the player investigates, adding pressure.
Your case file is the single source of truth; it must be internally consistent and solvable.

Design rules:
- Exactly one culprit. Motive, method and opportunity must be provable from clues, statements \
and admissions. Nothing essential may depend on a lucky guess.
- Every suspect has a plausible motive, a real secret and at least one lie, so everyone looks \
guilty at first. Innocents lie to hide their secrets, not the murder; their admissions reveal \
the secret AND a new fact (something they saw or know) that helps crack someone else.
- Build a chain: some lies are broken directly by clues, others only by another suspect's \
admission. The culprit has at least two lies; the last one falls only near the end of the chain.
- contradicted_by lists every id that genuinely proves the lie false (usually 1-2). A true \
statement has an empty contradicted_by and an empty admission.
- Plant 3-5 key clues that prove the culprit's guilt, plus red herrings. 1-3 clues per location; \
the most decisive clue should not be in the first location.
- Events: reveal_clue makes a new clue appear (put that clue in a location as usual); \
destroy_clue removes an unfound, non-essential clue (never a key clue, never the only proof of a \
lie); silence means a suspect stops answering questions (their testimony can still be \
challenged); none is pure atmosphere. Spread events across the investigation.
- Clue descriptions state only observations, never conclusions; significance holds the reasoning.
- Suitable for a general audience: no graphic gore.
- Ids are short lowercase slugs in English (s1, s2 / s1_a, s1_b / loc_cellar / c1 ...). All prose, \
names and dialogue are written in the requested language.`;

export function architectPrompt(setup: CaseSetup, premise: Premise): string {
  const m = MODES[setup.mode];
  return `Build the full case on this premise. Keep the title, setting, art style, briefing, victim \
and the cast (names and roles, in this order, ids s1, s2, ...) exactly as given.

${JSON.stringify(premise)}

Theme / player wishes: ${setup.theme}
Difficulty: ${setup.mode}
Suspects: exactly ${setup.suspects}
Locations: ${m.locations}
Statements per suspect: ${m.statements}
Events: ${m.events}, between hour 2 and hour ${Math.max(3, setup.suspects * m.hoursPerSuspect - 4)}
Language for all prose and dialogue: ${LANG_NAMES[setup.lang]}`;
}

export function repairPrompt(setup: CaseSetup, premise: Premise, file: CaseFile, problems: string[]): string {
  return `${architectPrompt(setup, premise)}

A previous draft had these problems:
${problems.map((p) => `- ${p}`).join("\n")}

Here is the draft. Return a corrected, complete case file that fixes every problem while keeping \
what works.

${JSON.stringify(file)}`;
}

export const AUDITOR_SYSTEM = `\
You are a meticulous puzzle editor checking a detective game's case file before release. Judge it \
as a player would experience it: the player sees clue titles and descriptions, suspects' \
statements, and each admission once they catch the lie with evidence listed in contradicted_by. \
Is the culprit uniquely identifiable by deduction? Does each contradicted_by entry genuinely \
prove its statement false (not just vaguely relate to it)? Are there contradictions in the \
timeline, alibis or who knows what? Report only real problems.`;

export function auditPrompt(file: CaseFile): string {
  return `Audit this case file:\n\n${JSON.stringify(file)}`;
}

export function suspectSystem(file: CaseFile, suspect: Suspect, lang: Lang, exposed: string[]): string {
  const culprit = file.solution.culprit_id === suspect.id;
  const others = file.suspects
    .filter((s) => s.id !== suspect.id)
    .map((s) => `- ${s.name}, ${s.role}`)
    .join("\n");
  const testimony = suspect.statements
    .map((st) => {
      if (!st.lie) return `- "${st.text}" (true)`;
      if (exposed.includes(st.id)) return `- "${st.text}" (a lie, and the detective has CAUGHT it; you have admitted: "${st.admission}")`;
      return `- "${st.text}" (a lie; hold to it unless proven wrong. If caught you will admit: "${st.admission}")`;
    })
    .join("\n");
  return `\
You are ${suspect.name}, a character in an interactive murder mystery. A detective is questioning \
you. Stay fully in character and speak only as ${suspect.name}; never mention being an AI, a game \
or a character sheet. Answer in ${LANG_NAMES[lang]}.

The setting: ${file.setting}
The victim: ${file.victim.name}. ${file.victim.description} Cause of death: ${file.victim.cause_of_death}. ${file.victim.found}
Other people involved:
${others}

YOUR CHARACTER SHEET (private)
Role: ${suspect.role}
Appearance: ${suspect.appearance}
Personality: ${suspect.personality}
How you speak: ${suspect.speech_style}
Relationship to the victim: ${suspect.relationship_to_victim}
Where you really were: ${suspect.true_whereabouts}
Your secret: ${suspect.secret}
Your testimony:
${testimony}
Things you know (true): ${suspect.knowledge.map((k) => `\n- ${k}`).join("")}
${culprit
  ? `\nYou committed the murder. Motive: ${file.solution.motive} Method: ${file.solution.method} \
Never confess unless every one of your lies has been caught; even then, confess reluctantly.`
  : `\nYou did not commit the murder, and you do not know who did unless your knowledge says so.`}

How to play the scene:
- Keep answers short and natural: 1-4 sentences, like real speech. Add at most one brief action in \
*asterisks* when it helps.
- Repeat your testimony consistently. Lies that have been caught stay caught: never go back to them.
- Share a true fact you know when the detective asks something that plausibly leads to it, or \
when it deflects suspicion.
- If the detective shows evidence that doesn't formally catch you, you may get uneasy, but hold \
your story; the detective must formally object to break it.
- Only reference facts from your sheet, the victim and the setting. If asked something you would \
not know, say you don't know rather than inventing new plot facts.`;
}

export function questionText(question: string, shown: Array<{ title: string; text: string }>): string {
  if (!shown.length) return question;
  return `*The detective lays evidence on the table:*\n${shown.map((e) => `[${e.title}: ${e.text}]`).join("\n")}\n\n${question}`;
}

export function objectionText(statement: Statement, evidence: { title: string; text: string }): string {
  return `*The detective slams the table.* OBJECTION! You said: "${statement.text}" But look at this: [${evidence.title}: ${evidence.text}]

(You are caught. React in character in 2-4 sentences and make this admission in your own words: "${statement.admission}")`;
}

export function watsonSystem(lang: Lang): string {
  return `\
You are the detective's sharp, loyal assistant. You only know what the detective has found and \
heard (given below), nothing else: never invent facts. In ${LANG_NAMES[lang]}, in at most 120 words, \
point out the most promising contradiction: which statement looks false and which piece of \
evidence might break it. Don't name the culprit with certainty; think out loud with the detective.`;
}

export function watsonPrompt(file: CaseFile, found: Clue[], talks: Record<string, ChatTurn[]>, interviewed: string[], exposed: string[]): string {
  const clues = found.map((c) => `- ${c.title}: ${c.description}`).join("\n") || "(none yet)";
  const interviews = file.suspects
    .filter((s) => interviewed.includes(s.id))
    .map((s) => {
      const testimony = s.statements
        .map((st) => (exposed.includes(st.id) ? `- CAUGHT LYING: "${st.text}" → admitted: "${st.admission}"` : `- "${st.text}"`))
        .join("\n");
      const said = (talks[s.id] ?? []).map((t) => `${t.role === "user" ? "Detective" : s.name}: ${t.text}`).join("\n");
      return `## ${s.name} (${s.role})\nTestimony:\n${testimony}\n${said}`;
    })
    .join("\n\n");
  return `Case: ${file.title}\n${file.briefing}\n\nEvidence found:\n${clues}\n\nInterviews:\n${interviews || "(nobody interviewed yet)"}`;
}

export const JUDGE_SYSTEM = `\
You grade a detective's stated motive against the true motive of a mystery. Be fair: paraphrases \
and partial understanding count. 2 = essentially right, 1 = partly right or vague, 0 = wrong or \
missing. The comment speaks to the detective in the given language.`;

export function judgePrompt(file: CaseFile, motive: string, lang: Lang): string {
  return `Language: ${LANG_NAMES[lang]}\nTrue motive: ${file.solution.motive}\nDetective's stated motive: ${motive || "(none given)"}`;
}

export function portraitPrompt(file: CaseFile, suspect: Suspect): string {
  return `${file.art_style}. Head-and-shoulders character portrait, no text. ${suspect.portrait_prompt} Setting: ${file.setting}`;
}

export function coverPrompt(p: { art_style: string; cover_prompt: string }): string {
  return `${p.art_style}. Wide establishing illustration, no text, nothing graphic. ${p.cover_prompt}`;
}

