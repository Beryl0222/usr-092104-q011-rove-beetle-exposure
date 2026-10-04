import assert from "node:assert/strict";
import test from "node:test";

import { RULE_PACK } from "../src/domain/rulepack.js";
import { HotlineService } from "../src/services/hotlineService.js";
import { EventStore } from "../src/store/eventStore.js";
import { validateEvent } from "../src/validator.js";

const fixedClock = () => new Date("2026-10-04T10:00:00+08:00");

function makeService() {
  return new HotlineService({ store: new EventStore(), rulePack: RULE_PACK, clock: fixedClock });
}

function lowRiskInput() {
  return {
    caller: { name: "王女士", phone: "13800000001", relation: "parent" },
    patient: { age_group: "adult" },
    exposure: {
      occurred_at: "2026-10-03T22:00:00+08:00",
      district: "雁塔区",
      body_sites: ["arms"],
      contact_manner: "crushed_on_skin",
    },
    symptoms: { lesion_area: "localized", lesion_types: ["erythema"], spread: "stable", systemic: [] },
    measures_taken: [],
    source: { type: "hotline_call", id: "call-001", at: "2026-10-04T10:00:00+08:00" },
  };
}

test("低风险报告：生成指导、随访节点，事件全部合法落库", () => {
  const svc = makeService();
  const { case_id, assessment, review_required } = svc.reportExposure(lowRiskInput());

  assert.equal(review_required, false);
  assert.equal(assessment.risk_level, "LOW");
  assert.equal(assessment.rule_version, RULE_PACK.version);

  const events = svc.store.all();
  assert.deepEqual(events.map((e) => e.event_type), ["EXPOSURE_REPORTED", "GUIDANCE_ISSUED"]);
  for (const event of events) assert.deepEqual(validateEvent(event), []);

  const view = svc.callerView(case_id);
  assert.equal(view.basis.rule_version, RULE_PACK.version);
  assert.ok(view.red_flags.length > 0);
  assert.equal(view.followup_nodes.length, 1);
  assert.equal(view.followup_nodes[0].due_at, "2026-10-05T02:00:00.000Z");
});

test("儿童高风险报告：进入人工复核，复核结论落库", () => {
  const svc = makeService();
  const input = lowRiskInput();
  input.patient = { age_group: "child" };
  input.symptoms = { lesion_area: "extensive", lesion_types: ["blisters", "exudate"], spread: "stable", systemic: [] };
  input.measures_taken = [{ remedy_id: "toothpaste" }];

  const { case_id, review_required } = svc.reportExposure(input);
  assert.equal(review_required, true);
  assert.deepEqual(svc.store.byType("CASE_ESCALATED").length, 1);

  const agent = svc.agentView(case_id);
  assert.equal(agent.status, "under_review");
  assert.ok(agent.escalation_rules.some((r) => r.id === "T-CHILD-HIGH-RISK"));
  assert.ok(agent.measures_taken[0].fact.includes("牙膏"));

  assert.throws(() => svc.closeFollowup(case_id, { outcome: "recovered" }), /复核/);
  svc.resolveReview(case_id, { reviewer: "皮肤科值班医师", decision: "confirm", note: "已电话指导急诊就医" });
  assert.equal(svc.agentView(case_id).status, "open");
  assert.equal(svc.store.byType("REVIEW_RESOLVED").length, 1);
});

test("症状恶化：重新分级并再次升级，坐席获得提示", () => {
  const svc = makeService();
  const { case_id } = svc.reportExposure(lowRiskInput());

  const updated = svc.recordSymptoms(case_id, {
    lesion_area: "localized",
    lesion_types: ["erythema", "blisters"],
    spread: "rapidly_expanding",
    systemic: [],
  });
  assert.equal(updated.risk_level, "MODERATE");
  assert.ok(updated.triggers.includes("T-RAPID-SPREAD"));
  assert.equal(svc.store.byType("CASE_ESCALATED").length, 1);
  assert.equal(svc.agentView(case_id).status, "under_review");
});

test("重复来电与跨机构反馈关联同一暴露，保留原来源", () => {
  const svc = makeService();
  const { case_id } = svc.reportExposure(lowRiskInput());

  assert.deepEqual(svc.findCasesByPhone("13800000001"), [case_id]);
  svc.linkCall(case_id, { id: "call-002", note: "同一暴露的第二次来电" });
  svc.recordFacilityOutcome(case_id, { facility_id: "hosp-xian-01", result: "已接诊，对症处理", note: "门诊随访" });

  const record = svc.agentView(case_id);
  assert.deepEqual(
    record.sources.map((s) => s.id),
    ["call-001", "call-002", "hosp-xian-01"],
  );
  assert.equal(record.facility_outcomes.length, 1);
  assert.equal(svc.store.byType("CALL_LINKED").length, 1);
  assert.equal(svc.store.byType("FACILITY_OUTCOME_RECORDED").length, 1);
});

test("随访：节点全部完成后才能关闭", () => {
  const svc = makeService();
  const { case_id } = svc.reportExposure(lowRiskInput());

  assert.throws(() => svc.closeFollowup(case_id, { outcome: "recovered" }), /随访节点/);
  const { node, suggest_reassessment } = svc.completeFollowupNode(case_id, "N1", "recovered");
  assert.equal(node.status, "done");
  assert.equal(suggest_reassessment, false);

  svc.closeFollowup(case_id, { outcome: "recovered" });
  assert.equal(svc.agentView(case_id).status, "closed");
  const closed = svc.store.byType("FOLLOWUP_CLOSED");
  assert.equal(closed.length, 1);
  assert.equal(closed[0].aggregate_type, "followup_episode");
});

test("随访结果变差时置提醒标志", () => {
  const svc = makeService();
  const { case_id } = svc.reportExposure(lowRiskInput());
  const { suggest_reassessment } = svc.completeFollowupNode(case_id, "N1", "worse");
  assert.equal(suggest_reassessment, true);
  assert.equal(svc.agentView(case_id).attention_flag, true);
});

test("事件存储拒绝版本冲突", () => {
  const svc = makeService();
  svc.reportExposure(lowRiskInput());
  const conflict = {
    event_id: "evt-x",
    event_type: "CASE_ESCALATED",
    aggregate_type: "exposure_case",
    aggregate_id: "case-x",
    occurred_at: "2026-10-04T10:00:00+08:00",
    version: 5,
    summary: "跳版本",
  };
  assert.throws(() => svc.store.append(conflict), /版本冲突/);
});
