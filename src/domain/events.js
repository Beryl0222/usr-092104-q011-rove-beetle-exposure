/**
 * 领域事件目录与信封构造。
 *
 * 信封字段沿用 contracts/domain.schema.json 的约定：
 * event_id / event_type / aggregate_type / aggregate_id / occurred_at / version / summary，
 * 业务内容放在可选的 payload 中，保持基础信封稳定。
 */

export const EVENT_TYPES = Object.freeze([
  // 初始登记
  "EXPOSURE_REPORTED",
  "SYMPTOM_UPDATED",
  "GUIDANCE_ISSUED",
  "CASE_ESCALATED",
  "FOLLOWUP_CLOSED",
  // 扩展：重复来电关联、跨机构反馈、人工复核、聚集上报
  "CALL_LINKED",
  "FACILITY_OUTCOME_RECORDED",
  "REVIEW_RESOLVED",
  "CLUSTER_REPORTED",
]);

export const AGGREGATE_TYPES = Object.freeze([
  "exposure_case",
  "symptom_observation",
  "triage_assessment",
  "followup_episode",
  "cluster_report",
]);

/**
 * 构造符合基础信封的事件对象。version 由调用方（事件存储）按聚合递增给出。
 */
export function buildEvent({ event_id, event_type, aggregate_type, aggregate_id, occurred_at, version, summary, payload }) {
  const event = { event_id, event_type, aggregate_type, aggregate_id, occurred_at, version, summary };
  if (payload !== undefined) event.payload = payload;
  return event;
}
