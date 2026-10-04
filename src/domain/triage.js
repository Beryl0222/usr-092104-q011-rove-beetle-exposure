/**
 * 分级引擎：解释执行临床审核规则包。
 *
 * 引擎自身不含任何医学判断，只做三件事：
 * 1. 核对规则包已通过审核（status === "approved"），否则拒绝执行；
 * 2. 计算关键事实缺失清单，并评估升级触发器与风险规则；
 * 3. 从固定目录装配指导语、转诊建议与随访节点参数。
 * 输出仅为风险等级与下一步提示，不构成疾病诊断，也不包含用药内容。
 */

export class RulePackError extends Error {
  constructor(message) {
    super(message);
    this.name = "RulePackError";
  }
}

export function assertApproved(pack) {
  if (!pack || pack.status !== "approved") {
    throw new RulePackError("规则包未通过临床审核，系统不得据此给出分级或指导");
  }
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** 规则条件求值：支持 all/any 组合与 eq/in/includes_any/non_empty 叶子运算 */
export function matchCondition(cond, ctx) {
  if (cond.all) return cond.all.every((c) => matchCondition(c, ctx));
  if (cond.any) return cond.any.some((c) => matchCondition(c, ctx));
  const value = getPath(ctx, cond.fact);
  switch (cond.op) {
    case "eq":
      return value === cond.value;
    case "in":
      return cond.value.includes(value);
    case "includes_any":
      return Array.isArray(value) && cond.value.some((v) => value.includes(v));
    case "non_empty":
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
    default:
      throw new RulePackError(`规则包含未知运算：${cond.op}`);
  }
}

/** 依据关键事实清单计算缺失项（填“未知”同样视为缺失） */
export function computeMissingFields(facts, pack) {
  const missing = [];
  for (const req of pack.required_facts) {
    const value = getPath(facts, req.path);
    if (value === undefined || value === null) {
      missing.push(req.label);
      continue;
    }
    if (req.non_empty && Array.isArray(value) && value.length === 0) {
      missing.push(req.label);
      continue;
    }
    if (req.not_in && req.not_in.includes(value)) {
      missing.push(req.label);
    }
  }
  return missing;
}

function buildGuidance(facts, level, triggers, pack) {
  const items = [];
  const push = (id) => items.push({ id, text: pack.guidance_catalog[id] });

  push("G-RINSE");
  push("G-NO-RUB");
  push("G-KEEP-DRY");

  let hasHarmfulRemedy = false;
  for (const measure of facts.measures_taken ?? []) {
    if (!measure.avoid_note) continue;
    hasHarmfulRemedy = true;
    items.push({ id: `REMEDY-${measure.remedy_id}`, remedy_id: measure.remedy_id, fact: measure.fact, text: measure.avoid_note });
  }
  if (hasHarmfulRemedy) push("G-NO-FOLK");

  if (level === "LOW") push("G-OBSERVE");
  if (level === "MODERATE") push("G-SEEK-SOON");
  if (level === "HIGH") push("G-SEEK-URGENT");
  push("G-RED-FLAG");
  if (triggers.length > 0) push("G-MANUAL-REVIEW");

  return items;
}

/**
 * 对一份暴露事实进行分级。
 * facts: { patient, exposure, symptoms, measures_taken }
 * 返回结构化评估结果；所有文案均来自规则包目录。
 */
export function evaluateExposure(facts, pack) {
  assertApproved(pack);

  const missing = computeMissingFields(facts, pack);
  const ctx = { ...facts, meta: { missing_fields: missing } };

  const triggers = pack.escalation_triggers.filter((t) => matchCondition(t.when, ctx)).map((t) => t.id);
  const triggerDescriptions = pack.escalation_triggers.filter((t) => triggers.includes(t.id)).map((t) => t.description);

  const rule = pack.risk_rules.find((r) => matchCondition(r.when, ctx));
  if (!rule) throw new RulePackError("规则包缺少兜底风险规则");
  const level = rule.level;

  return {
    rule_version: pack.version,
    risk_level: level,
    matched_rule: rule.id,
    rationale: rule.rationale,
    triggers,
    trigger_descriptions: triggerDescriptions,
    missing_fields: missing,
    guidance: buildGuidance(facts, level, triggers, pack),
    referral: pack.referral_by_level[level],
    followup_hours: pack.followup_hours[level],
    red_flags: pack.red_flags,
  };
}

/** 将一条自行处置记录规范化为“事实 + 避免二次刺激说明” */
export function normalizeMeasure(measure, pack) {
  const entry = pack.remedy_catalog[measure.remedy_id] ?? pack.remedy_catalog.other;
  return {
    remedy_id: measure.remedy_id in pack.remedy_catalog ? measure.remedy_id : "other",
    name: entry.name,
    fact: entry.fact,
    avoid_note: entry.avoid_note,
    detail: measure.detail ?? null,
  };
}
