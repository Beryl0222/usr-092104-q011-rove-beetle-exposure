import { validateEvent } from "../validator.js";

/**
 * 追加式事件存储：
 * - 写入前按基础信封校验；
 * - 每个聚合的 version 必须从 1 开始逐次递增，冲突即拒绝。
 */
export class EventStore {
  #events = [];
  #versions = new Map();

  #key(aggregateType, aggregateId) {
    return `${aggregateType}:${aggregateId}`;
  }

  nextVersion(aggregateType, aggregateId) {
    return (this.#versions.get(this.#key(aggregateType, aggregateId)) ?? 0) + 1;
  }

  append(event) {
    const errors = validateEvent(event);
    if (errors.length > 0) throw new Error(`事件校验失败：${errors.join("；")}`);
    const expected = this.nextVersion(event.aggregate_type, event.aggregate_id);
    if (event.version !== expected) {
      throw new Error(`聚合 ${event.aggregate_type}:${event.aggregate_id} 版本冲突：期望 ${expected}，收到 ${event.version}`);
    }
    this.#events.push(event);
    this.#versions.set(this.#key(event.aggregate_type, event.aggregate_id), event.version);
    return event;
  }

  all() {
    return [...this.#events];
  }

  byAggregate(aggregateType, aggregateId) {
    return this.#events.filter((e) => e.aggregate_type === aggregateType && e.aggregate_id === aggregateId);
  }

  byType(eventType) {
    return this.#events.filter((e) => e.event_type === eventType);
  }
}
