# 隐翅虫暴露分级随访

本仓库保存隐翅虫暴露分级随访的领域词汇、事件约定与基础校验代码，供相关单位统一对象身份、事件顺序和版本语义。

## 目录

- `contracts/domain.schema.json`：领域事件信封、稳定枚举与各事件的必填扩展字段。
- `data/sample.json`：一条中文联调样例。
- `data/sample-flow.json`：覆盖登记、升级、指导、关联、接诊反馈与随访关闭的联调流程样例。
- `src/`：事件基础字段与领域约定校验。
- `tests/`：领域资料一致性检查。

## 核心对象

- `exposure_case`：暴露档案。记录咨询人与患者关系、接触地点与方式；同一暴露的重复来电与跨机构反馈都关联到它。
- `consultation`：一次咨询来电。保留来源渠道，关联到既有暴露，不合并覆盖原来源。
- `symptom_observation`：症状观察。记录部位、范围、水疱与渗出等演变；照片等隐私材料仅存于照护链路，事件只携带引用。
- `triage_assessment`：分级评估。依据经临床审核的规则版本给出风险等级与下一步提示。
- `care_feedback`：医疗机构接诊结果反馈。
- `followup_episode`：恢复随访节点与关闭。
- `cluster_signal`：去标识时空聚集信号，仅供公共卫生人员识别聚集趋势。

## 已登记事件

| 事件 | 聚合 | 含义 | 必填扩展字段 |
| --- | --- | --- | --- |
| EXPOSURE_REPORTED | exposure_case | 登记暴露：咨询人关系、接触地点与方式 | —（信息不足也先登记，再升级复核） |
| CONSULTATION_LINKED | consultation | 重复来电关联同一暴露，保留来源渠道 | exposure_case_id、source_channel |
| SELF_CARE_RECORDED | exposure_case | 已自行采取的措施（含偏方）记录为已发生事实 | measure |
| SYMPTOM_UPDATED | symptom_observation | 症状演变更新 | symptom |
| GUIDANCE_ISSUED | triage_assessment | 按审核规则给出风险等级与下一步提示 | risk_level、rule_version |
| CASE_ESCALATED | triage_assessment | 触发人工复核 | escalation_reason |
| CARE_OUTCOME_RECORDED | care_feedback | 医疗机构接诊结果回传 | exposure_case_id、outcome |
| FOLLOWUP_CLOSED | followup_episode | 随访关闭 | closure_reason |
| CLUSTER_SIGNAL_PUBLISHED | cluster_signal | 去标识时空聚集信号上报 | region_code、case_count |

## 领域规则

- 系统不下诊断、不开药：`GUIDANCE_ISSUED` 只给出风险等级（`low` / `medium` / `high`）与下一步提示，必须携带 `rule_version`，来电者可查看当前建议依据、必须就医的情形与随访节点。
- 出现信息不足、症状快速扩大、面部等敏感部位、儿童高风险之一时，必须以 `CASE_ESCALATED` 进入人工复核，`escalation_reason` 取 `info_insufficient` / `rapid_spread` / `sensitive_site` / `child_high_risk`。
- 牙膏、酒精等偏方通过 `SELF_CARE_RECORDED` 记录为已发生事实，指导中说明如何避免二次刺激，不评判来电者。
- 重复来电与跨机构反馈分别通过 `CONSULTATION_LINKED` 与 `CARE_OUTCOME_RECORDED` 关联同一 `exposure_case`，保留来源渠道与接诊机构。
- 隐私数据仅用于照护；`CLUSTER_SIGNAL_PUBLISHED` 只含 `region_code`、时间窗与 `case_count` 等去标识内容，公共卫生角色不可浏览个人照片。
- `occurred_at` 为事件发生时间（带时区），`version` 从 1 开始按聚合递增。

## 本地检查

```bash
npm test
```
