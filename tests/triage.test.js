import assert from "node:assert/strict";
import test from "node:test";

import { RULE_PACK } from "../src/domain/rulepack.js";
import { evaluateExposure, normalizeMeasure, RulePackError } from "../src/domain/triage.js";

const baseFacts = () => ({
  patient: { age_group: "adult" },
  exposure: {
    occurred_at: "2026-10-03T22:00:00+08:00",
    district: "雁塔区",
    body_sites: ["arms"],
    contact_manner: "crushed_on_skin",
  },
  symptoms: { lesion_area: "localized", lesion_types: ["erythema"], spread: "stable", systemic: [] },
  measures_taken: [],
});

test("局部红斑且稳定：低风险，不触发复核", () => {
  const result = evaluateExposure(baseFacts(), RULE_PACK);
  assert.equal(result.risk_level, "LOW");
  assert.deepEqual(result.triggers, []);
  assert.equal(result.referral.level, "none");
  assert.deepEqual(result.followup_hours, [24]);
});

test("儿童大面积水疱：高风险并触发儿童高风险复核", () => {
  const facts = baseFacts();
  facts.patient.age_group = "child";
  facts.symptoms = { lesion_area: "extensive", lesion_types: ["erythema", "blisters"], spread: "stable", systemic: [] };
  const result = evaluateExposure(facts, RULE_PACK);
  assert.equal(result.risk_level, "HIGH");
  assert.ok(result.triggers.includes("T-CHILD-HIGH-RISK"));
  assert.equal(result.referral.level, "urgent");
});

test("症状快速扩大：触发人工复核", () => {
  const facts = baseFacts();
  facts.symptoms.spread = "rapidly_expanding";
  const result = evaluateExposure(facts, RULE_PACK);
  assert.ok(result.triggers.includes("T-RAPID-SPREAD"));
  assert.ok(result.guidance.some((g) => g.id === "G-MANUAL-REVIEW"));
});

test("面部受累：触发敏感部位复核", () => {
  const facts = baseFacts();
  facts.exposure.body_sites = ["face"];
  const result = evaluateExposure(facts, RULE_PACK);
  assert.ok(result.triggers.includes("T-SENSITIVE-SITE"));
  assert.equal(result.risk_level, "MODERATE");
});

test("关键信息缺失：触发信息不足复核并列出缺失项", () => {
  const facts = baseFacts();
  facts.symptoms.spread = "unknown";
  facts.exposure.contact_manner = "unknown";
  const result = evaluateExposure(facts, RULE_PACK);
  assert.ok(result.triggers.includes("T-INSUFFICIENT-INFO"));
  assert.ok(result.missing_fields.includes("扩散情况"));
  assert.ok(result.missing_fields.includes("接触方式"));
});

test("未通过临床审核的规则包被拒绝执行", () => {
  const draft = { ...RULE_PACK, status: "draft" };
  assert.throws(() => evaluateExposure(baseFacts(), draft), RulePackError);
});

test("错误偏方：记录已发生事实并给出避免二次刺激说明", () => {
  const facts = baseFacts();
  facts.measures_taken = [normalizeMeasure({ remedy_id: "toothpaste" }, RULE_PACK), normalizeMeasure({ remedy_id: "alcohol" }, RULE_PACK)];
  const result = evaluateExposure(facts, RULE_PACK);
  const remedyNotes = result.guidance.filter((g) => g.remedy_id);
  assert.equal(remedyNotes.length, 2);
  assert.ok(remedyNotes[0].fact.includes("牙膏"));
  assert.ok(remedyNotes[0].text.includes("清水"));
  assert.ok(result.guidance.some((g) => g.id === "G-NO-FOLK"));
});

test("指导语全部来自审核目录，不含诊断或处方内容", () => {
  const facts = baseFacts();
  facts.measures_taken = [normalizeMeasure({ remedy_id: "toothpaste" }, RULE_PACK)];
  const result = evaluateExposure(facts, RULE_PACK);
  for (const item of result.guidance) {
    if (item.remedy_id) continue; // 偏方说明来自 remedy_catalog，同样为固定文案
    assert.ok(RULE_PACK.guidance_catalog[item.id], `未知指导语：${item.id}`);
  }
  const text = JSON.stringify(result.guidance);
  assert.ok(!/处方|确诊|口服药|药膏/.test(text), "指导语不得包含诊断或用药内容");
});

test("评估结果携带规则版本，便于追溯依据", () => {
  const result = evaluateExposure(baseFacts(), RULE_PACK);
  assert.equal(result.rule_version, RULE_PACK.version);
  assert.equal(result.matched_rule, "R-LOW-LOCALIZED");
});
