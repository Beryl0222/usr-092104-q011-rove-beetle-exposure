import { AGGREGATE_TYPES, EVENT_TYPES } from "./domain/events.js";

const required = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

export function validateEvent(record) {
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) errors.push(`未知事件类型：${record.event_type}`);
  if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) errors.push(`未知聚合类型：${record.aggregate_type}`);
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) errors.push("version 必须是正整数");
  if ("occurred_at" in record && (typeof record.occurred_at !== "string" || Number.isNaN(Date.parse(record.occurred_at)))) {
    errors.push("occurred_at 必须是合法时间字符串");
  }
  for (const name of ["event_id", "aggregate_id", "summary"]) {
    if (name in record && (typeof record[name] !== "string" || record[name].length === 0)) errors.push(`${name} 必须是非空字符串`);
  }
  return errors;
}
