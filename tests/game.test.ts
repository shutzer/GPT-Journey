import { describe, expect, it } from "vitest";
import { DemoProvider } from "../src/ai/demo";
import { DEMO_CASE } from "../src/ai/demoCase";
import { AIError, type JsonRequest, type StreamRequest, type TextProvider } from "../src/ai/types";
import {
  accuse,
  buildCase,
  buildPremise,
  consultWatson,
  interrogate,
  interview,
  migrate,
  newRecord,
  newSetup,
  object,
  react,
  search,
  spend,
} from "../src/game/engine";
import {
  COST,
  MAX_STRIKES,
  composure,
  confessed,
  evidence,
  isSilenced,
  nextClue,
  offCase,
  pruneEvents,
  unprovableLies,
  validateCase,
} from "../src/game/rules";
import { CaseFile, jsonSchema, type Premise } from "../src/game/schema";
import type { CaseRecord } from "../src/game/state";

const setup = newSetup("night train", "en", "standard");
const demo = new DemoProvider(0);

async function drain<T>(gen: AsyncGenerator<string, T>): Promise<{ chunks: string[]; value: T }> {
  const chunks: string[] = [];
  for (let step = await gen.next(); ; step = await gen.next()) {
    if (step.done) return { chunks, value: step.value };
    chunks.push(step.value);
  }
}

const fresh = (): CaseRecord => newRecord(structuredClone(DEMO_CASE), setup, "demo");
const premise = async (): Promise<Premise> => buildPremise(demo, setup);

describe("case validation", () => {
  it("accepts the demo case, and every lie can be exposed", () => {
    expect(CaseFile.parse(DEMO_CASE)).toBeTruthy();
    expect(validateCase(DEMO_CASE, "standard", 4)).toEqual([]);
    expect(unprovableLies(DEMO_CASE)).toEqual([]);
  });

  it("catches broken cross-references", () => {
    const broken = structuredClone(DEMO_CASE);
    broken.solution.culprit_id = "nobody";
    broken.clues[0].location_id = "nowhere";
    broken.solution.key_clue_ids = ["c1", "c6"];
    broken.suspects[0].statements[0].contradicted_by = ["c99"];
    broken.suspects[0].statements[1].contradicted_by = ["c1"];
    const problems = validateCase(broken, "standard", 5).join("\n");
    expect(problems).toMatch(/culprit_id/);
    expect(problems).toMatch(/unknown location "nowhere"/);
    expect(problems).toMatch(/at least 3/);
    expect(problems).toMatch(/"c6" is marked as a red herring/);
    expect(problems).toMatch(/exactly 5 suspects/);
    expect(problems).toMatch(/"s1_a" is contradicted by unknown id "c99"/);
    expect(problems).toMatch(/True statement "s1_b"/);
  });

  it("finds lies that can never be exposed, following admission chains", () => {
    const file = structuredClone(DEMO_CASE);
    // Ana's admission is the only way to break Tomo's second lie; cut Ana loose and it falls too.
    file.suspects[0].statements[0].contradicted_by = ["s4_b_truth"];
    file.suspects[3].statements[1].contradicted_by = ["s1_a_truth"];
    expect(unprovableLies(file).map((l) => l.id).sort()).toEqual(["s1_a", "s4_b"]);
    expect(validateCase(file).join()).toMatch(/can never be exposed/);
  });

  it("drops unfair events instead of failing the case", () => {
    const file = structuredClone(DEMO_CASE);
    file.events.push(
      { at_hour: 5, title: "x", text: "x", effect: "destroy_clue", target: "c3" }, // key clue
      { at_hour: 5, title: "x", text: "x", effect: "destroy_clue", target: "c6" }, // only proof of s3_a
      { at_hour: 99, title: "x", text: "x", effect: "none", target: "" }, // after the deadline
      { at_hour: 5, title: "x", text: "x", effect: "silence", target: "ghost" },
    );
    const pruned = pruneEvents(file, 44);
    expect(pruned.events.map((e) => e.target)).toEqual(["c8", "c5", "s3"]);
  });

  it("emits a JSON schema every provider accepts: all fields required, closed objects", () => {
    const schema = jsonSchema(CaseFile) as { required: string[]; additionalProperties: boolean; properties: object };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    expect(JSON.stringify(schema)).not.toMatch(/minLength|maximum|minimum|\$schema/);
  });
});

describe("building a case", () => {
  it("writes the premise first, then drafts and audits, keeping the premise verbatim", async () => {
    const p = await premise();
    expect(p.cast).toHaveLength(4);
    const steps: string[] = [];
    let progress = 0;
    const file = await buildCase(demo, setup, { ...p, title: "Kept Title" }, (s) => steps.push(s), undefined, (n) => (progress = n));
    expect(file.title).toBe("Kept Title");
    expect(steps).toEqual(["draft", "audit", "done"]);
    expect(progress).toBeGreaterThan(1000);
  });

  it("sends an invalid draft back for repair with the problems listed", async () => {
    const prompts: string[] = [];
    let calls = 0;
    const flaky: TextProvider = {
      label: "flaky",
      async json(req: JsonRequest) {
        prompts.push(req.prompt);
        if (req.schemaName !== "case_file") return demo.json(req);
        calls++;
        const file = structuredClone(DEMO_CASE);
        if (calls === 1) file.suspects[1].statements[2].contradicted_by = ["nothing"];
        return file;
      },
      stream: demo.stream.bind(demo),
    };
    const steps: string[] = [];
    await buildCase(flaky, setup, await premise(), (s) => steps.push(s));
    expect(steps).toEqual(["draft", "repair", "audit", "done"]);
    expect(prompts[1]).toContain('Lie "s2_c" is contradicted by unknown id "nothing"');
  });

  it("gives up with a readable error when repairs keep failing", async () => {
    const hopeless: TextProvider = {
      label: "x",
      json: async (req) => (req.schemaName === "case_file" ? { nope: true } : demo.json(req)),
      stream: demo.stream.bind(demo),
    };
    await expect(buildCase(hopeless, setup, await premise())).rejects.toBeInstanceOf(AIError);
  });

  it("quick mode means 3 suspects and a shorter clock", () => {
    const quick = newSetup("x", "hr", "quick");
    expect(quick.suspects).toBe(3);
    expect(newRecord(DEMO_CASE, quick, "demo").timeTotal).toBeLessThan(fresh().timeTotal);
  });

  it("migrates records saved before statements and events existed", () => {
    const old = fresh() as Partial<CaseRecord>;
    delete old.exposed;
    delete old.board;
    delete old.fired;
    const r = migrate(old as CaseRecord);
    expect(r.exposed).toEqual([]);
    expect(r.board).toEqual({ pos: {}, strings: [] });
  });
});

describe("investigating", () => {
  it("searching reveals one clue at a time and costs time", () => {
    let r = fresh();
    const start = r.time;
    expect(search(r, "loc_compartment").clue?.id).toBe("c1");
    r = search(r, "loc_compartment").record;
    r = search(r, "loc_compartment").record;
    r = search(r, "loc_compartment").record;
    expect(r.found).toEqual(["c1", "c2", "c7"]);
    expect(r.time).toBe(start - 3 * COST.search);
    expect(nextClue(r, "loc_compartment")).toBeNull();
  });

  it("events fire as time passes: a clue appears, another is destroyed, a suspect falls silent", () => {
    let r = fresh();
    expect(nextClue(r, "loc_luggage")?.id).toBe("c5");
    let fired = spend(r, 6);
    expect(fired.events.map((e) => e.effect)).toEqual(["reveal_clue"]);
    r = fired.record;
    fired = spend(r, 8);
    expect(fired.events.map((e) => e.effect)).toEqual(["destroy_clue"]);
    r = fired.record;
    // The crate is gone; the telegram that arrived is still there to be found.
    expect(nextClue(r, "loc_luggage")?.id).toBe("c8");
    expect(evidence(search(r, "loc_luggage").record).map((e) => e.id)).toEqual(["c8"]);
    r = spend(r, 12).record;
    expect(isSilenced(r, "s3")).toBe(true);
  });

  it("an objection with the right proof exposes the lie and yields an admission to use against others", async () => {
    let r = interview(interview(fresh(), "s1"), "s4");
    r = search(r, "loc_dining").record; // c4, the dining car bill
    const hit = object(r, "s1_a", "c4");
    expect(hit.success).toBe(true);
    r = hit.record;
    expect(r.exposed).toEqual(["s1_a"]);
    expect(evidence(r).map((e) => e.id)).toContain("s1_a_truth");
    // Ana's admission breaks Tomo's claim that nobody went near the compartment.
    const chain = object(r, "s4_b", "s1_a_truth");
    expect(chain.success).toBe(true);
    const { value } = await drain(react(demo, r, "s4_b", "s1_a_truth"));
    expect(value).toMatch(/The doctor/);
  });

  it("a wrong objection costs credibility and time; three and you're off the case", () => {
    let r = interview(fresh(), "s1");
    r = search(r, "loc_compartment").record; // c1
    const start = r.time;
    for (let i = 0; i < MAX_STRIKES; i++) {
      const miss = object(r, "s1_b", "c1");
      expect(miss.success).toBe(false);
      r = miss.record;
    }
    expect(r.strikes).toBe(MAX_STRIKES);
    expect(r.time).toBe(start - MAX_STRIKES * (COST.objection + COST.objectionMiss));
    expect(offCase(r)).toBe(true);
    expect(() => object(r, "s1_a", "c1")).toThrow(AIError);
  });

  it("you can only object with evidence you actually have", () => {
    const r = interview(fresh(), "s1");
    expect(() => object(r, "s1_a", "c4")).toThrow(/don't have/);
    expect(() => object(fresh(), "s1_a", "c1")).toThrow(/don't have/);
  });

  it("exposing every lie breaks the culprit", () => {
    let r = interview(fresh(), "s2");
    for (const loc of ["loc_compartment", "loc_compartment", "loc_compartment", "loc_doctor"]) r = search(r, loc).record;
    expect(composure(r, "s2")).toBe(1);
    r = object(r, "s2_a", "c2").record;
    r = object(r, "s2_b", "c7").record;
    expect(confessed(r)).toBe(false);
    r = object(r, "s2_c", "c3").record;
    expect(composure(r, "s2")).toBe(0);
    expect(confessed(r)).toBe(true);
  });

  it("interrogation replays history and tells the actor which lies are already caught", async () => {
    let seen: StreamRequest | null = null;
    const spy: TextProvider = {
      label: "spy",
      json: demo.json.bind(demo),
      async *stream(req) {
        seen = req;
        yield "Fine.";
      },
    };
    let r = interview(fresh(), "s1");
    r = search(r, "loc_dining").record;
    r = object(r, "s1_a", "c4").record;
    r = (await drain(interrogate(spy, r, "s1", "Where were you?", ["c4"]))).value.record;
    await drain(interrogate(spy, r, "s1", "And then?", []));
    const msgs = seen!.messages;
    expect(msgs[1]).toEqual({ role: "assistant", content: DEMO_CASE.suspects[0].opening_statement });
    expect(msgs[2].content).toContain("[Dining car bill:");
    expect(msgs.at(-1)).toEqual({ role: "user", content: "And then?" });
    expect(seen!.system).toContain("the detective has CAUGHT it");
    expect(seen!.system).toContain("You did not commit the murder");
    expect(seen!.system).not.toContain(DEMO_CASE.solution.motive);
  });

  it("silenced suspects refuse questions", async () => {
    const r = spend(fresh(), 26).record;
    await expect(drain(interrogate(demo, r, "s3", "Hello?", []))).rejects.toThrow(/refuses/);
  });

  it("Watson costs time and keeps notes", async () => {
    const r = fresh();
    const { value } = await drain(consultWatson(demo, r));
    expect(value.record.watson).toHaveLength(1);
    expect(value.record.time).toBe(r.time - COST.watson);
  });
});

describe("the verdict", () => {
  it("rewards exposed lies, cited key evidence, motive and a confession", async () => {
    let r = interview(fresh(), "s2");
    for (const loc of ["loc_compartment", "loc_compartment", "loc_compartment", "loc_doctor"]) r = search(r, loc).record;
    for (const [st, ev] of [["s2_a", "c2"], ["s2_b", "c7"], ["s2_c", "c3"]]) r = object(r, st, ev).record;
    const done = await accuse(demo, r, { culpritId: "s2", motive: "Revenge for his brother on the Adria Star", evidence: ["c3", "c2", "c7"] });
    const v = done.verdict!;
    expect(v.correct && v.confessed).toBe(true);
    expect(v.liesExposed).toBe(3);
    expect(v.motive.score).toBe(2);
    expect(v.score).toBeGreaterThanOrEqual(75);
  });

  it("wrong objections cost points", async () => {
    let r = interview(fresh(), "s1");
    r = search(r, "loc_compartment").record;
    const clean = await accuse(demo, r, { culpritId: "s2", motive: "", evidence: [] });
    r = object(r, "s1_b", "c1").record;
    const sloppy = await accuse(demo, r, { culpritId: "s2", motive: "", evidence: [] });
    expect(sloppy.verdict!.score).toBeLessThan(clean.verdict!.score);
  });

  it("a wrong accusation fails", async () => {
    const done = await accuse(demo, fresh(), { culpritId: "s3", motive: "", evidence: [] });
    expect(done.verdict?.correct).toBe(false);
    expect(done.verdict?.rank).toBe("rank.wrong");
  });
});
