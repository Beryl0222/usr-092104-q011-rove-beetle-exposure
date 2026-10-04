const REQUIRED_FIELDS = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

export const EVENT_TYPES = [
  "EXPOSURE_REPORTED",
  "CONSULTATION_LINKED",
  "SELF_CARE_RECORDED",
  "SYMPTOM_UPDATED",
  "GUIDANCE_ISSUED",
  "CASE_ESCALATED",
  "CARE_OUTCOME_RECORDED",
  "FOLLOWUP_CLOSED",
  "CLUSTER_SIGNAL_PUBLISHED",
];

export const AGGREGATE_TYPES = [
  "exposure_case",
  "consultation",
  "symptom_observation",
  "triage_assessment",
  "care_feedback",
  "followup_episode",
  "cluster_signal",
];

// 每类事件只能作用于登记的聚合，保证跨机构交换时对象身份一致。
export const EVENT_AGGREGATE = {
  EXPOSURE_REPORTED: "exposure_case",
  CONSULTATION_LINKED: "consultation",
  SELF_CARE_RECORDED: "exposure_case",
  SYMPTOM_UPDATED: "symptom_observation",
  GUIDANCE_ISSUED: "triage_assessment",
  CASE_ESCALATED: "triage_assessment",
  CARE_OUTCOME_RECORDED: "care_feedback",
  FOLLOWUP_CLOSED: "followup_episode",
  CLUSTER_SIGNAL_PUBLISHED: "cluster_signal",
};

// 各领域事件在信封之外必须携带的字段，用于建议依据可追溯与暴露关联。
// EXPOSURE_REPORTED 不设额外必填：信息不足的来电也应先登记，再升级人工复核。
export const EVENT_REQUIRED_FIELDS = {
  EXPOSURE_REPORTED: [],
  CONSULTATION_LINKED: ["exposure_case_id", "source_channel"],
  SELF_CARE_RECORDED: ["measure"],
  SYMPTOM_UPDATED: ["symptom"],
  GUIDANCE_ISSUED: ["risk_level", "rule_version"],
  CASE_ESCALATED: ["escalation_reason"],
  CARE_OUTCOME_RECORDED: ["exposure_case_id", "outcome"],
  FOLLOWUP_CLOSED: ["closure_reason"],
  CLUSTER_SIGNAL_PUBLISHED: ["region_code", "case_count"],
};

export const RISK_LEVELS = ["low", "medium", "high"];

export const ESCALATION_REASONS = ["info_insufficient", "rapid_spread", "sensitive_site", "child_high_risk"];

const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function validateEvent(record) {
  const errors = [];
  for (const name of REQUIRED_FIELDS) {
    if (!(name in record)) errors.push(`缺少字段：${name}`);
  }
  for (const name of ["event_id", "aggregate_id", "summary"]) {
    if (name in record && (typeof record[name] !== "string" || record[name].length === 0)) {
      errors.push(`${name} 必须是非空字符串`);
    }
  }
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未登记的事件类型：${record.event_type}`);
  }
  if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`未登记的聚合类型：${record.aggregate_type}`);
  }
  if (EVENT_TYPES.includes(record.event_type) && AGGREGATE_TYPES.includes(record.aggregate_type)) {
    const expected = EVENT_AGGREGATE[record.event_type];
    if (record.aggregate_type !== expected) {
      errors.push(`事件 ${record.event_type} 应作用于 ${expected}，而不是 ${record.aggregate_type}`);
    }
  }
  if ("occurred_at" in record && (typeof record.occurred_at !== "string" || !DATE_TIME_PATTERN.test(record.occurred_at))) {
    errors.push("occurred_at 必须是带时区的 ISO 8601 日期时间");
  }
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if (EVENT_TYPES.includes(record.event_type)) {
    for (const field of EVENT_REQUIRED_FIELDS[record.event_type]) {
      if (!(field in record)) errors.push(`缺少字段：${field}`);
    }
  }
  if ("risk_level" in record && !RISK_LEVELS.includes(record.risk_level)) {
    errors.push(`未登记的风险等级：${record.risk_level}`);
  }
  if ("escalation_reason" in record && !ESCALATION_REASONS.includes(record.escalation_reason)) {
    errors.push(`未登记的升级原因：${record.escalation_reason}`);
  }
  if ("case_count" in record && (!Number.isInteger(record.case_count) || record.case_count < 1)) {
    errors.push("case_count 必须是正整数");
  }
  return errors;
}
