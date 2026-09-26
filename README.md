# GPT-Journey: Case Files

A detective game where every murder is written fresh by AI, checked for fairness before you
see it, and every suspect is played by their own AI actor who knows only their side of the story.

Search the scenes for clues, interrogate the suspects, lay evidence on the table to break their
lies, then name the killer, the motive and your proof. The case file was sealed before you
started, so the answer is fixed and the mystery can actually be solved.

Runs entirely in the browser. Bring your own key for **Claude**, **OpenAI** or **Gemini**, or
play the built-in offline demo case.

## How a case works

1. **The premise** (a quick, low-effort call) sets the scene: title, briefing, victim and cast.
   You read it, with the cover painting in, while the rest of the case is written.
2. **The architect** writes the sealed case file around it: each suspect's formal testimony
   (true statements and lies, with the exact evidence that disproves each lie and what the
   suspect admits when caught), locations, clues, red herrings, timed events and the solution.
3. **Mechanical checks** (`src/game/rules.ts`) verify every cross-reference and replay the whole
   investigation with perfect play: every lie must be exposable through the chain of clues and
   admissions, even after events destroy evidence. Failures go back to the model to repair;
   unfair events are dropped.
4. **The auditor** (an independent call) reads the case as a player would and flags ambiguity.

## How you play

- **Search** the scenes (3 h each) for clues.
- **Interview** suspects to take their testimony, and question them freely. Each suspect is a
  separate AI actor that knows only its own character sheet.
- **Object!** Pick a statement and the clue, statement or admission that proves it false.
  A hit breaks the lie: the suspect admits something new, which becomes evidence against others.
  A miss costs time and credibility; three misses and you're off the case. Break every lie the
  culprit told and they confess.
- **Events** fire as the clock runs: new evidence turns up, unfound evidence is destroyed,
  a suspect lawyers up and stops answering questions.
- **The board**: every clue, statement and admission as a draggable card. Tie cards together
  with red string, and raise objections straight from the board.
- **Accuse** the culprit with motive and evidence. Scoring counts the right culprit, lies
  exposed, key evidence cited, the motive (graded by the model), time left, a confession, and
  your wrong objections.
- **Quick / standard / hard** cases (3, 4 or 5 suspects), a **case of the day** (same setting and
  twist for everyone that day, streak counter) and a **career** rank from your solved cases.
  These are stored in your browser; there is no server or shared leaderboard.

## Providers

| | Story & suspects | Illustrations |
|---|---|---|
| Claude | `claude-opus-5` (adaptive thinking, structured outputs, server-side refusal fallbacks) | — |
| OpenAI | `gpt-5.6` (Responses API, strict JSON schema) | `gpt-image-2` |
| Gemini | `gemini-3-flash-preview` (JSON schema, thinking levels) | `gemini-3.1-flash-image` |
| Demo | Offline, one hand-written case | Procedural placeholders |

Mix freely, e.g. Claude for the mystery with Gemini painting the portraits. Model names are
editable in Settings, and **Load list** fetches the models your key can use.

API keys stay in your browser and are sent only to the provider you choose. By default they are
forgotten when you close the tab; tick "Remember keys" to keep them in `localStorage`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # game logic + wire-format tests for all three SDKs (no network)
npm run build      # static site in dist/
```

The build is a static site with relative paths, so it can be hosted anywhere. The included
workflow deploys `main` to GitHub Pages; enable it under *Settings → Pages → Source: GitHub
Actions*.

## Layout

```
src/
  ai/         provider adapters (Claude, OpenAI, Gemini, offline demo) behind one interface
  game/       case schema (Zod → JSON Schema), rules & scoring, prompts, engine
  store/      IndexedDB (cases) and localStorage (settings)
  ui/         React components, English/Croatian UI
tests/        Vitest: game flow with the demo provider, request/response shape per SDK
```

## History

The [first version](https://github.com/shutzer/GPT-Journey/tree/e6e6144) (2023) was a Flask
choose-your-own-adventure on GPT-3.5 that pulled options out of free text with a regex.

## License

MIT
