/**
 * 访问控制：隐私数据仅用于照护。
 *
 * - caller：只能看自己个案的指导依据、红旗情形与随访节点；
 * - hotline_agent / clinical_reviewer：照护所需的完整资料（含照片与身份信息）；
 * - public_health：只看去标识聚集报告，无法访问任何个人身份与照片。
 */

export const ROLES = Object.freeze({
  CALLER: "caller",
  AGENT: "hotline_agent",
  REVIEWER: "clinical_reviewer",
  PUBLIC_HEALTH: "public_health",
});

const GRANTS = {
  [ROLES.CALLER]: new Set(["own_guidance", "own_followup", "own_red_flags"]),
  [ROLES.AGENT]: new Set(["pii", "photos", "guidance", "escalation", "followup", "facility_outcome"]),
  [ROLES.REVIEWER]: new Set(["pii", "photos", "guidance", "escalation", "followup", "facility_outcome", "review"]),
  [ROLES.PUBLIC_HEALTH]: new Set(["cluster_report"]),
};

export class PrivacyError extends Error {
  constructor(role, resource) {
    super(`角色 ${role} 无权访问 ${resource}`);
    this.name = "PrivacyError";
  }
}

export function canAccess(role, resource) {
  return GRANTS[role]?.has(resource) ?? false;
}

export function assertAccess(role, resource) {
  if (!canAccess(role, resource)) throw new PrivacyError(role, resource);
}
