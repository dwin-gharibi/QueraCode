import * as assert from "assert";
import { normalizedScore, outcomeOf } from "../../src/constants";
import { faDateTime, faNum, faPercent } from "../../src/panels/render";


describe("normalizedScore", () => {
  it("prefers calculated_judge_score, the 0-100 the site shows", () => {
    assert.strictEqual(normalizedScore({ judge_score: 100000, calculated_judge_score: 100 }), 100);
    assert.strictEqual(normalizedScore({ judge_score: 0, calculated_judge_score: 0 }), 0);
  });

  it("undoes the x1000 scaling when only the raw score is present", () => {
    assert.strictEqual(normalizedScore({ judge_score: 100000 }), 100);
    assert.strictEqual(normalizedScore({ judge_score: 42500 }), 42.5);
  });

  it("passes an already-0-100 raw score through", () => {
    assert.strictEqual(normalizedScore({ judge_score: 75 }), 75);
  });

  it("is undefined when no score has arrived", () => {
    assert.strictEqual(normalizedScore({}), undefined);
    assert.strictEqual(normalizedScore({ short_judge_result: "S" }), undefined);
  });
});

describe("outcomeOf", () => {
  it("treats a full score under code S as accepted, not partial", () => {
    const o = outcomeOf({ short_judge_result: "S", judge_score: 100000, calculated_judge_score: 100 });
    assert.strictEqual(o.accepted, true);
    assert.strictEqual(o.partial, false);
    assert.strictEqual(o.fa, "پذیرفته‌شده");
    assert.strictEqual(o.score, 100);
  });

  it("treats a zero score under the same code S as rejected", () => {
    const o = outcomeOf({ short_judge_result: "S", judge_score: 0, calculated_judge_score: 0 });
    assert.strictEqual(o.accepted, false);
    assert.strictEqual(o.partial, false);
    assert.strictEqual(o.fa, "رد شده");
  });

  it("calls a middling score partial", () => {
    const o = outcomeOf({ short_judge_result: "S", calculated_judge_score: 60 });
    assert.strictEqual(o.partial, true);
    assert.strictEqual(o.accepted, false);
    assert.strictEqual(o.fa, "امتیاز جزئی");
  });

  it("honours a real verdict code over the score", () => {
    const o = outcomeOf({ short_judge_result: "TLE", calculated_judge_score: 0 });
    assert.strictEqual(o.en, "Time limit exceeded");
    assert.strictEqual(o.accepted, false);
  });

  it("reports pending when nothing has been judged yet", () => {
    const o = outcomeOf({ state: "P" });
    assert.strictEqual(o.pending, true);
    assert.strictEqual(o.fa, "در انتظار داوری");
  });
});

describe("Persian formatting", () => {
  it("converts digits", () => {
    assert.strictEqual(faNum(1405), "۱۴۰۵");
    assert.strictEqual(faNum("10/10"), "۱۰/۱۰");
  });

  it("uses the RTL percent sign so bidi cannot reorder it", () => {
    assert.strictEqual(faPercent(63), "۶۳٪");
    assert.ok(!faPercent(63).includes("%"));
  });

  it("formats an ISO timestamp into the Persian calendar", () => {
    const out = faDateTime("2026-08-08T07:41:33.712375+00:00");
    assert.ok(!out.includes("T"), `still ISO: ${out}`);
    assert.ok(/[۰-۹]/.test(out), `no Persian digits: ${out}`);
  });

  it("leaves a timestamp Quera already formatted alone", () => {
    const pre = "۱۶ مرداد ۱۴۰۵ ساعت ۲۲:۰۸";
    assert.strictEqual(faDateTime(pre), pre);
  });

  it("survives an empty timestamp", () => {
    assert.strictEqual(faDateTime(""), "");
  });
});
