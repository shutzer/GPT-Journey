import { describe, expect, it } from "vitest";
import { DemoProvider } from "../src/ai/demo";
import { DEMO_CASE } from "../src/ai/demoCase";
import { AIError, type JsonRequest, type StreamRequest, type TextProvider } from "../src/ai/types";
import { accuse, buildCase, consultWatson, interrogate, newRecord, search } from "../src/game/engine";
import { COST, nextClue, validateCase } from "../src/game/rules";
import { CaseFile, jsonSchema } from "../src/game/schema";
import type { CaseRecord, CaseSetup } from "../src/game/state";

const setup: CaseSetup = { theme: "night train", suspects: 4, lang: "en" };
const demo = new DemoProvider(0);

async function drain<T>(gen: AsyncGenerator<string, T>): Promise<{ chunks: string[]; value: T }> {
  const chunks: string[] = [];
  for (let step = await gen.next(); ; step = await gen.next()) {
    if (step.done) return { chunks, value: step.value };
    chunks.push(step.value);
  }
}

describe("case validation", () => {
  it("accepts the demo case", () => {
    expect(CaseFile.parse(DEMO_CASE)).toBeTruthy();
    expect(validateCase(DEMO_CASE, 4)).toEqual([]);
  });

  it("catches broken cross-references", () => {
    const broken = structuredClone(DEMO_CASE);
    broken.solution.culprit_id = "nobody";
    broken.clues[0].location_id = "nowhere";
    broken.solution.key_clue_ids = ["c1", "c6"];
    const problems = validateCase(broken, 5).join("\n");
    expect(problems).toMatch(/culprit_id/);
    expect(problems).toMatch(/unknown location "nowhere"/);
    expect(problems).toMatch(/at least 3/);
    expect(problems).toMatch(/"c6" is marked as a red herring/);
    expect(problems).toMatch(/exactly 5 suspects/);
  });

  it("emits a JSON schema every provider accepts: all fields required, closed objects", () => {
    const schema = jsonSchema(CaseFile) as { required: string[]; additionalProperties: boolean; properties: object };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    expect(JSON.stringify(schema)).not.toMatch(/minLength|maximum|minimum|\$schema/);
  });
});

describe("building a case", () => {
  it("drafts and audits", async () => {
    const steps: string[] = [];
    const file = await buildCase(demo, setup, (s) => steps.push(s));
    expect(file.title).toBe(DEMO_CASE.title);
    expect(steps).toEqual(["draft", "audit", "done"]);
  });

  it("sends an invalid draft back for repair with the problems listed", async () => {
    const prompts: string[] = [];
    let calls = 0;
    const flaky: TextProvider = {
      label: "flaky",
      async json(req: JsonRequest) {
        prompts.push(req.prompt);
        if (req.schemaName === "audit") return { solvable: true, issues: [] };
        calls++;
        const file = structuredClone(DEMO_CASE);
        if (calls === 1) file.solution.culprit_id = "ghost";
        return file;
      },
      stream: demo.stream.bind(demo),
    };
    const steps: string[] = [];
    const file = await buildCase(flaky, setup, (s) => steps.push(s));
    expect(file.solution.culprit_id).toBe("s2");
    expect(steps).toEqual(["draft", "repair", "audit", "done"]);
    expect(prompts[1]).toContain("culprit_id is not a suspect id");
  });

  it("gives up with a readable error when repairs keep failing", async () => {
    const hopeless: TextProvider = { label: "x", json: async () => ({ nope: true }), stream: demo.stream.bind(demo) };
    await expect(buildCase(hopeless, setup)).rejects.toBeInstanceOf(AIError);
  });
});

describe("playing", () => {
  const fresh = (): CaseRecord => newRecord(structuredClone(DEMO_CASE), setup, "demo");

  it("searching reveals one clue at a time and costs time", () => {
    let r = fresh();
    const start = r.time;
    const first = search(r, "loc_compartment");
    expect(first.clue?.id).toBe("c1");
    r = search(first.record, "loc_compartment").record;
    r = search(r, "loc_compartment").record;
    expect(r.found).toEqual(["c1", "c2", "c7"]);
    expect(r.time).toBe(start - 3 * COST.search);
    expect(nextClue(r, "loc_compartment")).toBeNull();
    const again = search(r, "loc_compartment");
    expect(again.clue).toBeNull();
    expect(again.record.time).toBe(r.time);
  });

  it("interrogation streams, then records the exchange with the evidence shown", async () => {
    let r = fresh();
    r = search(r, "loc_doctor").record; // c3
    r = search(r, "loc_compartment").record; // c1
    r = search(r, "loc_compartment").record; // c2
    const { chunks, value } = await drain(interrogate(demo, r, "s2", "Explain this.", ["c3", "c2", "c5"]));
    expect(chunks.length).toBeGreaterThan(3);
    expect(value.talks.s2.at(-1)?.text).toMatch(/I put it in his brandy/);
    // c5 was never found, so it cannot be shown.
    expect(value.talks.s2[0].evidence).toEqual(["c3", "c2"]);
    expect(value.time).toBe(r.time - COST.question);
  });

  it("history replays to the suspect with evidence and opening statement", async () => {
    let seen: StreamRequest | null = null;
    const spy: TextProvider = {
      label: "spy",
      json: demo.json.bind(demo),
      async *stream(req) {
        seen = req;
        yield "Fine.";
      },
    };
    let r = search(fresh(), "loc_dining").record; // c4
    r = (await drain(interrogate(spy, r, "s1", "Where were you?", ["c4"]))).value;
    await drain(interrogate(spy, r, "s1", "And then?", []));
    const msgs = seen!.messages;
    expect(msgs[1]).toEqual({ role: "assistant", content: DEMO_CASE.suspects[0].opening_statement });
    expect(msgs[2].content).toContain("[Dining car bill:");
    expect(msgs.at(-1)).toEqual({ role: "user", content: "And then?" });
    expect(seen!.system).toContain("You did not commit the murder");
    expect(seen!.system).not.toContain(DEMO_CASE.solution.motive);
  });

  it("only the culprit's actor knows the truth", async () => {
    let system = "";
    const spy: TextProvider = {
      label: "spy",
      json: demo.json.bind(demo),
      async *stream(req) {
        system = req.system;
        yield "…";
      },
    };
    await drain(interrogate(spy, fresh(), "s2", "Hello", []));
    expect(system).toContain("You committed the murder");
  });

  it("Watson costs time and keeps notes", async () => {
    const r = fresh();
    const { value } = await drain(consultWatson(demo, r));
    expect(value.watson).toHaveLength(1);
    expect(value.time).toBe(r.time - COST.watson);
  });

  it("scores a correct accusation with key evidence and motive", async () => {
    let r = fresh();
    for (const loc of ["loc_compartment", "loc_compartment", "loc_compartment", "loc_doctor"]) r = search(r, loc).record;
    const done = await accuse(demo, r, { culpritId: "s2", motive: "Revenge for his brother on the Adria Star", evidence: ["c3", "c2", "c7"] });
    expect(done.verdict?.correct).toBe(true);
    expect(done.verdict?.keyCited).toBe(3);
    expect(done.verdict?.motive.score).toBe(2);
    expect(done.verdict!.score).toBeGreaterThanOrEqual(90);
    expect(done.verdict?.rank).toBe("rank.legend");
  });

  it("a wrong accusation fails", async () => {
    const done = await accuse(demo, fresh(), { culpritId: "s3", motive: "", evidence: [] });
    expect(done.verdict?.correct).toBe(false);
    expect(done.verdict?.rank).toBe("rank.wrong");
    expect(done.verdict!.score).toBeLessThanOrEqual(10);
  });
});
