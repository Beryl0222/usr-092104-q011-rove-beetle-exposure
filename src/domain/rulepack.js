/**
 * 隐翅虫暴露分级规则包（临床审核版）。
 *
 * 规则以数据形式承载，引擎（triage.js）只负责解释执行：
 * - status 必须为 "approved"，未通过临床审核的规则包一律拒绝执行；
 * - 每次规则变更必须提升 version 并更新 reviewed_by / reviewed_at；
 * - 指导语全部来自 guidance_catalog 与 remedy_catalog 的固定文案，
 *   目录中不含诊断结论与用药处方，系统在结构上无法输出此类内容。
 */

const SENSITIVE_SITES = ["face", "eyes", "eyelids", "lips", "neck", "genitals", "mucosa"];
const SEVERE_LESIONS = ["blisters", "exudate"];

const CHILD_HIGH_RISK = {
  all: [
    { fact: "patient.age_group", op: "eq", value: "child" },
    {
      any: [
        { fact: "symptoms.lesion_area", op: "eq", value: "extensive" },
        { fact: "symptoms.lesion_types", op: "includes_any", value: SEVERE_LESIONS },
      ],
    },
  ],
};

const pack = {
  version: "RB-2026.09",
  status: "approved",
  reviewed_by: "区域皮肤科临床审核组",
  reviewed_at: "2026-09-15",

  /** 部位与形态词表，供录入端校验 */
  body_sites: ["face", "eyes", "eyelids", "lips", "neck", "trunk", "arms", "hands", "legs", "feet", "genitals", "mucosa"],
  sensitive_sites: SENSITIVE_SITES,
  lesion_types: ["erythema", "papules", "blisters", "pustules", "exudate", "erosion", "crust"],
  contact_manners: ["crushed_on_skin", "brushed_contact", "unknown"],

  /** 关键事实清单；缺失或填“未知”即视为信息不足 */
  required_facts: [
    { path: "patient.age_group", label: "患者年龄段" },
    { path: "exposure.occurred_at", label: "接触时间" },
    { path: "exposure.body_sites", label: "接触部位", non_empty: true },
    { path: "exposure.contact_manner", label: "接触方式", not_in: ["unknown"] },
    { path: "symptoms.lesion_area", label: "皮损范围", not_in: ["unknown"] },
    { path: "symptoms.lesion_types", label: "皮损形态", non_empty: true },
    { path: "symptoms.spread", label: "扩散情况", not_in: ["unknown"] },
  ],

  /** 命中任一触发器即进入人工复核 */
  escalation_triggers: [
    {
      id: "T-INSUFFICIENT-INFO",
      description: "关键信息不足，无法可靠分级",
      when: { fact: "meta.missing_fields", op: "non_empty" },
    },
    {
      id: "T-RAPID-SPREAD",
      description: "症状快速扩大",
      when: { fact: "symptoms.spread", op: "eq", value: "rapidly_expanding" },
    },
    {
      id: "T-SENSITIVE-SITE",
      description: "累及面部等敏感部位",
      when: { fact: "exposure.body_sites", op: "includes_any", value: SENSITIVE_SITES },
    },
    {
      id: "T-CHILD-HIGH-RISK",
      description: "儿童且皮损范围大或已起疱渗液",
      when: CHILD_HIGH_RISK,
    },
  ],

  /** 风险分级：自上而下取第一条命中，R-LOW-LOCALIZED 为兜底 */
  risk_rules: [
    {
      id: "R-HIGH-SYSTEMIC",
      level: "HIGH",
      rationale: "出现发热等全身症状",
      when: { fact: "symptoms.systemic", op: "non_empty" },
    },
    {
      id: "R-HIGH-EXTENSIVE-SEVERE",
      level: "HIGH",
      rationale: "大范围皮损伴水疱或渗出",
      when: {
        all: [
          { fact: "symptoms.lesion_area", op: "eq", value: "extensive" },
          { fact: "symptoms.lesion_types", op: "includes_any", value: SEVERE_LESIONS },
        ],
      },
    },
    {
      id: "R-HIGH-SENSITIVE-SEVERE",
      level: "HIGH",
      rationale: "敏感部位出现水疱或渗出",
      when: {
        all: [
          { fact: "exposure.body_sites", op: "includes_any", value: SENSITIVE_SITES },
          { fact: "symptoms.lesion_types", op: "includes_any", value: SEVERE_LESIONS },
        ],
      },
    },
    {
      id: "R-HIGH-CHILD",
      level: "HIGH",
      rationale: "儿童大范围皮损或起疱渗液",
      when: CHILD_HIGH_RISK,
    },
    {
      id: "R-MOD-SEVERE-LESION",
      level: "MODERATE",
      rationale: "局部出现水疱或渗出",
      when: { fact: "symptoms.lesion_types", op: "includes_any", value: SEVERE_LESIONS },
    },
    {
      id: "R-MOD-SPREADING",
      level: "MODERATE",
      rationale: "皮损仍在扩大",
      when: { fact: "symptoms.spread", op: "in", value: ["expanding", "rapidly_expanding"] },
    },
    {
      id: "R-MOD-SENSITIVE",
      level: "MODERATE",
      rationale: "敏感部位受累",
      when: { fact: "exposure.body_sites", op: "includes_any", value: SENSITIVE_SITES },
    },
    {
      id: "R-LOW-LOCALIZED",
      level: "LOW",
      rationale: "局部红斑、病情稳定",
      when: { all: [] },
    },
  ],

  /** 固定指导文案目录：不含诊断结论，不含任何用药/处方内容 */
  guidance_catalog: {
    "G-RINSE": "以流动清水或生理盐水轻柔冲洗接触部位，动作轻，不要搓揉",
    "G-NO-RUB": "避免抓挠、摩擦患处，不要自行挑破水疱",
    "G-KEEP-DRY": "保持局部清洁干燥，衣着宽松，避免汗液浸渍",
    "G-OBSERVE": "居家观察：记录皮损范围与形态变化，按随访节点向热线反馈",
    "G-SEEK-SOON": "建议24小时内前往皮肤科门诊就诊",
    "G-SEEK-URGENT": "请尽快前往急诊或皮肤科就诊，不要拖延",
    "G-RED-FLAG": "出现以下任一情况请立即就医：皮损快速扩大、眼或口等黏膜受累、发热、化脓、剧烈疼痛",
    "G-MANUAL-REVIEW": "该咨询已转人工复核，请保持电话畅通，坐席将尽快回电",
    "G-NO-FOLK": "请勿再使用牙膏、酒精、风油精等刺激性物品涂抹患处",
  },

  /**
   * 偏方记录目录：fact 记录已发生的事实，avoid_note 说明如何避免二次刺激。
   * 只记录与劝阻，不评价、不给出替代药物。
   */
  remedy_catalog: {
    toothpaste: {
      name: "牙膏",
      fact: "已在患处涂抹牙膏",
      avoid_note: "牙膏含摩擦剂与发泡成分，可能加重刺激；请以清水轻柔洗去，不要用力擦拭",
    },
    alcohol: {
      name: "酒精",
      fact: "已用酒精擦拭患处",
      avoid_note: "酒精刺激性强，可能加重灼痛并损伤皮肤屏障；请停止擦拭，以清水轻柔冲洗",
    },
    wind_oil: {
      name: "风油精",
      fact: "已在患处涂抹风油精",
      avoid_note: "风油精含挥发性刺激成分，可能加重灼痛与红斑；请以清水轻柔洗去",
    },
    vinegar: {
      name: "醋",
      fact: "已用醋涂抹患处",
      avoid_note: "醋的酸性刺激可能加重皮损；请停止使用并以清水轻柔冲洗",
    },
    other: {
      name: "其他自行处置",
      fact: "已自行采取其他处置",
      avoid_note: "未经确认的自行处置可能带来二次刺激；请停止并以清水轻柔清洁，如有变化及时告知热线",
    },
  },

  /** 转诊建议按风险等级给出，只描述去向与时限 */
  referral_by_level: {
    LOW: { level: "none", specialty: null, note: "暂无需就诊，居家观察并按随访节点反馈" },
    MODERATE: { level: "clinic", specialty: "皮肤科", note: "建议24小时内前往皮肤科门诊" },
    HIGH: { level: "urgent", specialty: "皮肤科/急诊", note: "请尽快前往急诊或皮肤科" },
  },

  /** 随访节点（相对评估时间的小时偏移） */
  followup_hours: { LOW: [24], MODERATE: [24, 72], HIGH: [12, 72] },

  /** 必须立即就医的红旗情形，对来电者公开 */
  red_flags: ["皮损快速扩大", "眼、口等黏膜受累", "发热或精神差", "化脓或剧烈疼痛", "婴幼儿或儿童皮损范围大"],
};

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

export const RULE_PACK = deepFreeze(pack);
