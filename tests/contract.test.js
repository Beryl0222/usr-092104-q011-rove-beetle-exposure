import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AGGREGATE_TYPES, EVENT_TYPES } from "../src/domain/events.js";
import { validateEvent } from "../src/validator.js";

const loadJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("样例符合领域约定", async () => {
  const sample = await loadJson("../data/sample.json");
  assert.deepEqual(validateEvent(sample), []);
});

test("代码中的事件目录与契约 schema 保持一致", async () => {
  const schema = await loadJson("../contracts/domain.schema.json");
  assert.deepEqual(new Set(schema.properties.event_type.enum), new Set(EVENT_TYPES));
  assert.deepEqual(new Set(schema.properties.aggregate_type.enum), new Set(AGGREGATE_TYPES));
});

test("基础信封校验拒绝不合法事件", () => {
  const base = {
    event_id: "e1",
    event_type: "EXPOSURE_REPORTED",
    aggregate_type: "exposure_case",
    aggregate_id: "a1",
    occurred_at: "2026-10-04T10:00:00+08:00",
    version: 1,
    summary: "测试",
  };
  assert.deepEqual(validateEvent(base), []);
  assert.ok(validateEvent({ ...base, event_type: "NOT_A_TYPE" }).some((e) => e.includes("未知事件类型")));
  assert.ok(validateEvent({ ...base, aggregate_type: "unknown" }).some((e) => e.includes("未知聚合类型")));
  assert.ok(validateEvent({ ...base, version: 0 }).some((e) => e.includes("version")));
  assert.ok(validateEvent({ ...base, occurred_at: "不是时间" }).some((e) => e.includes("occurred_at")));
  assert.ok(validateEvent({ ...base, summary: "" }).some((e) => e.includes("summary")));
  const { summary, ...missing } = base;
  assert.ok(validateEvent(missing).some((e) => e.includes("缺少字段：summary")));
});
