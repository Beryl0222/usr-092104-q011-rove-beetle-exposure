/**
 * 聚集性趋势上报：只输出“日期 × 区县”的去标识计数。
 *
 * - 不含个案编号、姓名、电话、照片等任何可识别信息；
 * - 计数低于 MIN_BUCKET_SIZE 的桶整体抑制，防止小样本反推个人。
 */

export const MIN_BUCKET_SIZE = 3;

export function buildClusterReport(cases, { from, to, minBucket = MIN_BUCKET_SIZE, generatedAt } = {}) {
  const buckets = new Map();
  for (const record of cases) {
    const time = record.exposure?.occurred_at ?? record.created_at;
    const date = String(time).slice(0, 10);
    if (from && date < from) continue;
    if (to && date > to) continue;
    const district = record.exposure?.district ?? "未知";
    const key = `${date}|${district}`;
    const bucket = buckets.get(key) ?? { date, district, case_count: 0, high_risk_count: 0 };
    bucket.case_count += 1;
    const latest = record.assessments?.[record.assessments.length - 1];
    if (latest?.risk_level === "HIGH") bucket.high_risk_count += 1;
    buckets.set(key, bucket);
  }

  const rows = [...buckets.values()]
    .sort((a, b) => (a.date === b.date ? a.district.localeCompare(b.district) : a.date.localeCompare(b.date)))
    .map((bucket) =>
      bucket.case_count < minBucket
        ? { date: bucket.date, district: bucket.district, suppressed: true }
        : { date: bucket.date, district: bucket.district, case_count: bucket.case_count, high_risk_count: bucket.high_risk_count, suppressed: false },
    );

  return {
    generated_at: (generatedAt ?? new Date()).toISOString(),
    window: { from: from ?? null, to: to ?? null },
    min_bucket_size: minBucket,
    rows,
  };
}
