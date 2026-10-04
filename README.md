# 隐翅虫暴露分级随访

区域健康热线使用的隐翅虫暴露分级与随访后端。系统保存咨询人与患者关系、接触地点与方式、症状演变、已采取措施、指导规则版本、转诊建议、医疗机构接诊结果与恢复随访，只依据经过临床审核的规则给出风险等级与下一步提示，**不诊断疾病、不自动开药**。

## 目录

- `contracts/domain.schema.json`：领域事件信封与稳定枚举。
- `data/sample.json`：一条中文联调样例。
- `src/domain/events.js`：事件目录与信封构造。
- `src/domain/rulepack.js`：临床审核规则包（纯数据，含版本与审核记录）。
- `src/domain/triage.js`：分级引擎，只执行 `status: "approved"` 的规则包。
- `src/domain/followup.js`：按风险等级生成随访节点。
- `src/domain/privacy.js`：角色访问控制。
- `src/domain/cluster.js`：时空聚集去标识上报。
- `src/store/eventStore.js`：追加式事件存储，聚合版本递增。
- `src/services/hotlineService.js`：热线服务编排与三类角色视图。
- `src/validator.js`：事件基础字段校验。
- `tests/`：契约一致性、分级规则、服务流程、隐私与聚集检查。

## 核心对象与事件

核心对象为 exposure_case、symptom_observation、triage_assessment、followup_episode、cluster_report。已登记事件：

| 事件 | 含义 |
| --- | --- |
| EXPOSURE_REPORTED | 新暴露报告（含咨询人关系、接触地点方式、已采取措施） |
| SYMPTOM_UPDATED | 症状演变观察 |
| GUIDANCE_ISSUED | 分级与指导（携带规则版本与命中规则） |
| CASE_ESCALATED | 触发人工复核 |
| CALL_LINKED | 重复来电关联同一暴露，保留原来源 |
| FACILITY_OUTCOME_RECORDED | 医疗机构接诊结果反馈 |
| REVIEW_RESOLVED | 人工复核结论 |
| FOLLOWUP_CLOSED | 随访关闭 |
| CLUSTER_REPORTED | 聚集性趋势去标识上报 |

事件信封字段（event_id / event_type / aggregate_type / aggregate_id / occurred_at / version / summary）保持稳定，业务内容放在 `payload` 中，后续服务应保持事件兼容性。

## 规则治理

- 风险等级、升级触发器、指导文案、偏方说明、转诊建议、随访节点全部来自 `rulepack.js` 中经临床审核的数据；引擎拒绝执行未审核（非 `approved`）的规则包。
- 信息不足、症状快速扩大、面部等敏感部位、儿童高风险，一律进入人工复核。
- 错误偏方（牙膏、酒精、风油精等）记录已发生事实，并给出避免二次刺激的说明；指导语目录不含诊断与用药内容。
- 规则变更必须提升 `version` 并更新审核记录，每次指导均携带规则版本以便追溯。

## 隐私与角色

- `caller`：查看本人个案的建议依据、必须就医的红旗情形与随访节点。
- `hotline_agent` / `clinical_reviewer`：照护所需的完整资料，坐席视图附带升级触发器清单。
- `public_health`：仅可查看按“日期 × 区县”汇总的去标识聚集报告（小计数桶抑制），无法访问照片与身份信息。

## 本地检查

```bash
npm test
```
