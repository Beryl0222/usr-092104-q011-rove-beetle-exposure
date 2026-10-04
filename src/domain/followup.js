/** 随访节点：按风险等级对应的偏移小时数生成 */

export const NODE_STATUS = Object.freeze(["pending", "done", "missed"]);

export function buildFollowupSchedule(riskLevel, baseTime, pack) {
  const hours = pack.followup_hours[riskLevel];
  if (!hours) throw new Error(`未知风险等级：${riskLevel}`);
  const base = baseTime instanceof Date ? baseTime.getTime() : Date.parse(baseTime);
  return hours.map((h, index) => ({
    node_id: `N${index + 1}`,
    offset_hours: h,
    due_at: new Date(base + h * 3600 * 1000).toISOString(),
    status: "pending",
    result: null,
    completed_at: null,
  }));
}

export function allNodesFinished(nodes) {
  return nodes.every((n) => n.status !== "pending");
}
