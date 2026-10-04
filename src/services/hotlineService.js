import { randomUUID } from "node:crypto";

import { buildClusterReport } from "../domain/cluster.js";
import { buildEvent } from "../domain/events.js";
import { allNodesFinished, buildFollowupSchedule } from "../domain/followup.js";
import { assertAccess, ROLES } from "../domain/privacy.js";
import { evaluateExposure, normalizeMeasure } from "../domain/triage.js";

export class CaseNotFoundError extends Error {
  constructor(caseId) {
    super(`个案不存在：${caseId}`);
    this.name = "CaseNotFoundError";
  }
}

export class CaseStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "CaseStateError";
  }
}

/**
 * 区域健康热线：隐翅虫暴露分级与随访服务。
 * 所有状态变化都以领域事件落库，聚合版本由事件存储保证递增。
 */
export class HotlineService {
  constructor({ store, rulePack, clock = () => new Date() }) {
    this.store = store;
    this.pack = rulePack;
    this.clock = clock;
    this.cases = new Map();
  }

  #emit(eventType, aggregateType, aggregateId, summary, payload) {
    const event = buildEvent({
      event_id: `evt-${randomUUID()}`,
      event_type: eventType,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      occurred_at: this.clock().toISOString(),
      version: this.store.nextVersion(aggregateType, aggregateId),
      summary,
      payload,
    });
    return this.store.append(event);
  }

  #getCase(caseId) {
    const record = this.cases.get(caseId);
    if (!record) throw new CaseNotFoundError(caseId);
    return record;
  }

  /** 首次报告：登记暴露、记录已采取措施、分级并给出指导 */
  reportExposure(input) {
    const now = this.clock();
    const caseId = `case-${randomUUID()}`;
    const assessmentId = `triage-${randomUUID()}`;
    const episodeId = `followup-${randomUUID()}`;

    const measures = (input.measures_taken ?? []).map((m) => ({ ...normalizeMeasure(m, this.pack), recorded_at: now.toISOString() }));
    const facts = { patient: input.patient, exposure: input.exposure, symptoms: input.symptoms, measures_taken: measures };
    const assessment = evaluateExposure(facts, this.pack);
    const needsReview = assessment.triggers.length > 0;

    const record = {
      id: caseId,
      status: needsReview ? "under_review" : "open",
      created_at: now.toISOString(),
      caller: input.caller,
      patient: input.patient,
      sources: [input.source ?? { type: "hotline_call", id: `call-${randomUUID()}`, at: now.toISOString() }],
      exposure: input.exposure,
      measures_taken: measures,
      symptoms_history: [{ ...input.symptoms, observed_at: now.toISOString(), source: "initial" }],
      assessments: [{ id: assessmentId, at: now.toISOString(), ...assessment }],
      review: { status: needsReview ? "pending" : "none", rounds: needsReview ? [{ opened_at: now.toISOString(), reasons: assessment.trigger_descriptions }] : [] },
      followup: { episode_id: episodeId, nodes: buildFollowupSchedule(assessment.risk_level, now, this.pack) },
      facility_outcomes: [],
      attachments: input.attachments ?? [],
      attention_flag: false,
    };
    this.cases.set(caseId, record);

    this.#emit("EXPOSURE_REPORTED", "exposure_case", caseId, "新隐翅虫暴露报告", {
      caller: input.caller,
      patient: input.patient,
      exposure: input.exposure,
      measures_taken: measures,
      source: record.sources[0],
    });
    this.#emit("GUIDANCE_ISSUED", "triage_assessment", assessmentId, `分级 ${assessment.risk_level}（规则 ${assessment.rule_version}）`, {
      case_id: caseId,
      ...assessment,
    });
    if (needsReview) {
      this.#emit("CASE_ESCALATED", "exposure_case", caseId, "触发人工复核", { reasons: assessment.trigger_descriptions, triggers: assessment.triggers });
    }

    return { case_id: caseId, assessment: record.assessments[0], review_required: needsReview };
  }

  /** 症状演变：追加观察、重新分级，必要时升级人工复核 */
  recordSymptoms(caseId, symptoms, source = "hotline_call") {
    const record = this.#getCase(caseId);
    if (record.status === "closed") throw new CaseStateError("个案已关闭，不能再记录症状");
    const now = this.clock();

    const observationId = `obs-${randomUUID()}`;
    record.symptoms_history.push({ ...symptoms, observed_at: now.toISOString(), source });
    this.#emit("SYMPTOM_UPDATED", "symptom_observation", observationId, "症状更新", { case_id: caseId, symptoms, source });

    const facts = { patient: record.patient, exposure: record.exposure, symptoms, measures_taken: record.measures_taken };
    const assessment = evaluateExposure(facts, this.pack);
    const assessmentId = `triage-${randomUUID()}`;
    record.assessments.push({ id: assessmentId, at: now.toISOString(), ...assessment });
    this.#emit("GUIDANCE_ISSUED", "triage_assessment", assessmentId, `分级 ${assessment.risk_level}（规则 ${assessment.rule_version}）`, {
      case_id: caseId,
      ...assessment,
    });

    this.#escalateIfNeeded(record, assessment, now);
    return record.assessments[record.assessments.length - 1];
  }

  /** 重复来电：关联到同一暴露，保留各自来源，不覆盖原记录 */
  linkCall(caseId, call) {
    const record = this.#getCase(caseId);
    const linked = { type: call.type ?? "hotline_call", id: call.id ?? `call-${randomUUID()}`, at: this.clock().toISOString(), note: call.note ?? null };
    record.sources.push(linked);
    this.#emit("CALL_LINKED", "exposure_case", caseId, "重复来电关联", { linked_source: linked, all_sources: record.sources });
    return linked;
  }

  /** 按来电号码查找可能相关的既有暴露个案 */
  findCasesByPhone(phone) {
    return [...this.cases.values()].filter((c) => c.caller?.phone === phone).map((c) => c.id);
  }

  /** 跨机构反馈：医疗机构接诊结果关联到同一暴露 */
  recordFacilityOutcome(caseId, outcome) {
    const record = this.#getCase(caseId);
    const entry = {
      facility_id: outcome.facility_id,
      received_at: outcome.received_at ?? this.clock().toISOString(),
      result: outcome.result,
      note: outcome.note ?? null,
    };
    record.facility_outcomes.push(entry);
    record.sources.push({ type: "facility", id: outcome.facility_id, at: entry.received_at });
    this.#emit("FACILITY_OUTCOME_RECORDED", "exposure_case", caseId, "医疗机构接诊结果", entry);
    return entry;
  }

  /** 人工复核结论：只记录人的决定，系统分级仍由规则包给出 */
  resolveReview(caseId, { reviewer, decision, note }) {
    const record = this.#getCase(caseId);
    if (record.review.status !== "pending") throw new CaseStateError("当前没有待复核事项");
    const round = record.review.rounds[record.review.rounds.length - 1];
    round.resolved_at = this.clock().toISOString();
    round.resolution = { reviewer, decision, note: note ?? null };
    record.review.status = "resolved";
    if (record.status === "under_review") record.status = "open";
    this.#emit("REVIEW_RESOLVED", "exposure_case", caseId, "人工复核完成", { reviewer, decision, note: note ?? null });
  }

  /** 随访节点回填；结果变差时给坐席提示重新评估 */
  completeFollowupNode(caseId, nodeId, result) {
    const record = this.#getCase(caseId);
    const node = record.followup.nodes.find((n) => n.node_id === nodeId);
    if (!node) throw new CaseStateError(`随访节点不存在：${nodeId}`);
    if (node.status !== "pending") throw new CaseStateError(`随访节点 ${nodeId} 已处理`);
    node.status = "done";
    node.result = result;
    node.completed_at = this.clock().toISOString();
    if (result === "worse") record.attention_flag = true;
    return { node, suggest_reassessment: result === "worse" };
  }

  /** 关闭随访：须所有节点完成且不在复核中 */
  closeFollowup(caseId, { outcome }) {
    const record = this.#getCase(caseId);
    if (record.status === "closed") throw new CaseStateError("个案已关闭");
    if (record.review.status === "pending") throw new CaseStateError("人工复核未完成，不能关闭随访");
    if (!allNodesFinished(record.followup.nodes)) throw new CaseStateError("仍有未完成的随访节点，不能关闭");
    record.status = "closed";
    this.#emit("FOLLOWUP_CLOSED", "followup_episode", record.followup.episode_id, "随访关闭", { case_id: caseId, outcome });
  }

  /** 聚集性趋势：去标识计数，供公共卫生角色使用 */
  clusterReport({ from, to } = {}) {
    const report = buildClusterReport([...this.cases.values()], { from, to, generatedAt: this.clock() });
    const reportId = `cluster-${randomUUID()}`;
    this.#emit("CLUSTER_REPORTED", "cluster_report", reportId, "聚集性趋势去标识上报", report);
    return report;
  }

  /** 附件（如照片）访问：按角色控制，公共卫生角色一律拒绝 */
  getAttachment(role, caseId, attachmentId) {
    assertAccess(role, "photos");
    const record = this.#getCase(caseId);
    const attachment = record.attachments.find((a) => a.id === attachmentId);
    if (!attachment) throw new CaseStateError(`附件不存在：${attachmentId}`);
    return attachment;
  }

  /** 来电者视图：当前建议依据、必须就医的情形、随访节点 */
  callerView(caseId) {
    const record = this.#getCase(caseId);
    const latest = record.assessments[record.assessments.length - 1];
    return {
      case_id: caseId,
      status: record.status,
      risk_level: latest.risk_level,
      basis: {
        rule_version: latest.rule_version,
        matched_rule: latest.matched_rule,
        rationale: latest.rationale,
        reviewed_by: this.pack.reviewed_by,
      },
      guidance: latest.guidance,
      referral: latest.referral,
      red_flags: latest.red_flags,
      followup_nodes: record.followup.nodes.map(({ node_id, due_at, status, result }) => ({ node_id, due_at, status, result })),
      review_status: record.review.status,
    };
  }

  /** 坐席视图：完整个案 + 哪些变化需要升级 */
  agentView(caseId) {
    const record = this.#getCase(caseId);
    return {
      ...record,
      escalation_rules: this.pack.escalation_triggers.map(({ id, description }) => ({ id, description })),
    };
  }

  /** 附件登记（仅照护角色可录入） */
  addAttachment(role, caseId, attachment) {
    assertAccess(role, "photos");
    const record = this.#getCase(caseId);
    const entry = { id: attachment.id ?? `att-${randomUUID()}`, kind: attachment.kind ?? "photo", visibility: "care_team", ref: attachment.ref };
    record.attachments.push(entry);
    return entry;
  }

  #escalateIfNeeded(record, assessment, now) {
    if (assessment.triggers.length === 0) return;
    if (record.review.status === "pending") return;
    record.review.status = "pending";
    record.review.rounds.push({ opened_at: now.toISOString(), reasons: assessment.trigger_descriptions });
    record.status = "under_review";
    this.#emit("CASE_ESCALATED", "exposure_case", record.id, "触发人工复核", { reasons: assessment.trigger_descriptions, triggers: assessment.triggers });
  }
}

export { ROLES };
