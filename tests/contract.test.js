import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AGGREGATE_TYPES, EVENT_TYPES, validateEvent } from "../src/validator.js";

const loadJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const baseEvent = {
  event_id: "evt-test",
  event_type: "EXPOSURE_REPORTED",
  aggregate_type: "exposure_case",
  aggregate_id: "case-test",
  occurred_at: "2026-10-04T09:00:00+08:00",
  version: 1,
  summary: "测试事件",
};

test("样例符合领域约定", async () => {
  const sample = await loadJson("../data/sample.json");
  assert.deepEqual(validateEvent(sample), []);
});

test("联调流程样例全部通过校验", async () => {
  const flow = await loadJson("../data/sample-flow.json");
  for (const event of flow) {
    assert.deepEqual(validateEvent(event), [], `${event.event_type} 应通过校验`);
  }
});

test("校验器与契约枚举保持一致", async () => {
  const schema = await loadJson("../contracts/domain.schema.json");
  assert.deepEqual([...EVENT_TYPES].sort(), [...schema.properties.event_type.enum].sort());
  assert.deepEqual([...AGGREGATE_TYPES].sort(), [...schema.properties.aggregate_type.enum].sort());
});

test("拒绝未登记的事件类型", () => {
  const errors = validateEvent({ ...baseEvent, event_type: "DIAGNOSIS_MADE" });
  assert.ok(errors.some((e) => e.includes("未登记的事件类型")));
});

test("事件必须作用于登记的聚合", () => {
  const errors = validateEvent({
    ...baseEvent,
    event_type: "GUIDANCE_ISSUED",
    aggregate_type: "exposure_case",
    risk_level: "low",
    rule_version: "paederus-guidance-2026.09",
  });
  assert.ok(errors.some((e) => e.includes("应作用于 triage_assessment")));
});

test("指导必须携带风险等级与规则版本", () => {
  const errors = validateEvent({
    ...baseEvent,
    event_type: "GUIDANCE_ISSUED",
    aggregate_type: "triage_assessment",
  });
  assert.ok(errors.some((e) => e.includes("缺少字段：risk_level")));
  assert.ok(errors.some((e) => e.includes("缺少字段：rule_version")));
});

test("升级原因必须来自登记枚举", () => {
  const errors = validateEvent({
    ...baseEvent,
    event_type: "CASE_ESCALATED",
    aggregate_type: "triage_assessment",
    escalation_reason: "looks_serious",
  });
  assert.ok(errors.some((e) => e.includes("未登记的升级原因")));
});

test("关联事件必须指向同一暴露并保留来源", () => {
  const errors = validateEvent({ ...baseEvent, event_type: "CONSULTATION_LINKED", aggregate_type: "consultation" });
  assert.ok(errors.some((e) => e.includes("缺少字段：exposure_case_id")));
  assert.ok(errors.some((e) => e.includes("缺少字段：source_channel")));
});

test("聚集信号必须去标识并携带统计", () => {
  const errors = validateEvent({
    ...baseEvent,
    event_type: "CLUSTER_SIGNAL_PUBLISHED",
    aggregate_type: "cluster_signal",
    region_code: "610113",
    case_count: 0,
  });
  assert.ok(errors.some((e) => e.includes("case_count 必须是正整数")));
});

test("拒绝不合规的基础字段", () => {
  const errors = validateEvent({ ...baseEvent, occurred_at: "2026-10-04", summary: "" });
  assert.ok(errors.some((e) => e.includes("occurred_at 必须是带时区的 ISO 8601 日期时间")));
  assert.ok(errors.some((e) => e.includes("summary 必须是非空字符串")));
});
