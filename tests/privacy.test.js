import assert from "node:assert/strict";
import test from "node:test";

import { MIN_BUCKET_SIZE } from "../src/domain/cluster.js";
import { PrivacyError, ROLES } from "../src/domain/privacy.js";
import { RULE_PACK } from "../src/domain/rulepack.js";
import { HotlineService } from "../src/services/hotlineService.js";
import { EventStore } from "../src/store/eventStore.js";

const fixedClock = () => new Date("2026-10-04T10:00:00+08:00");

function makeService() {
  return new HotlineService({ store: new EventStore(), rulePack: RULE_PACK, clock: fixedClock });
}

function inputFor(district, overrides = {}) {
  return {
    caller: { name: "张先生", phone: "13900000002", relation: "self" },
    patient: { age_group: "adult" },
    exposure: {
      occurred_at: "2026-10-03T21:00:00+08:00",
      district,
      body_sites: ["legs"],
      contact_manner: "brushed_contact",
    },
    symptoms: { lesion_area: "localized", lesion_types: ["erythema"], spread: "stable", systemic: [] },
    measures_taken: [],
    ...overrides,
  };
}

test("公共卫生角色无法访问照片与个人身份，只能看去标识聚集报告", () => {
  const svc = makeService();
  const { case_id } = svc.reportExposure(inputFor("雁塔区"));
  const att = svc.addAttachment(ROLES.AGENT, case_id, { kind: "photo", ref: "blob://photo-1" });

  assert.equal(svc.getAttachment(ROLES.AGENT, case_id, att.id).ref, "blob://photo-1");
  assert.throws(() => svc.getAttachment(ROLES.PUBLIC_HEALTH, case_id, att.id), PrivacyError);
  assert.throws(() => svc.addAttachment(ROLES.PUBLIC_HEALTH, case_id, {}), PrivacyError);
});

test("聚集报告：按日期与区县计数，小计数桶被抑制，输出不含任何可识别信息", () => {
  const svc = makeService();
  // 雁塔区 3 例（达到最小桶），碑林区 1 例（应被抑制）
  svc.reportExposure(inputFor("雁塔区", { caller: { name: "甲", phone: "13900000010", relation: "self" } }));
  svc.reportExposure(inputFor("雁塔区", { caller: { name: "乙", phone: "13900000011", relation: "self" } }));
  svc.reportExposure(inputFor("雁塔区", { caller: { name: "丙", phone: "13900000012", relation: "self" } }));
  svc.reportExposure(inputFor("碑林区", { caller: { name: "丁", phone: "13900000013", relation: "self" } }));

  const report = svc.clusterReport({ from: "2026-10-01", to: "2026-10-31" });
  const yanta = report.rows.find((r) => r.district === "雁塔区");
  const beilin = report.rows.find((r) => r.district === "碑林区");

  assert.equal(yanta.case_count, 3);
  assert.equal(yanta.suppressed, false);
  assert.equal(beilin.suppressed, true);
  assert.equal(beilin.case_count, undefined);
  assert.equal(report.min_bucket_size, MIN_BUCKET_SIZE);

  const raw = JSON.stringify(report);
  for (const identifier of ["甲", "乙", "丙", "丁", "1390000001", "case-"]) {
    assert.ok(!raw.includes(identifier), `聚集报告不得包含可识别信息：${identifier}`);
  }

  assert.equal(svc.store.byType("CLUSTER_REPORTED").length, 1);
});

test("来电者视图只含本人个案的指导依据与随访节点", () => {
  const svc = makeService();
  const { case_id } = svc.reportExposure(inputFor("雁塔区"));
  const view = svc.callerView(case_id);

  assert.ok(view.basis.rationale);
  assert.ok(Array.isArray(view.guidance));
  assert.ok(!("caller" in view) && !("sources" in view), "来电者视图不应暴露内部来源记录");
  assert.ok(!("review" in view), "来电者视图不应暴露复核内部记录");
});
