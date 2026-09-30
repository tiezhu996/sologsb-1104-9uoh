/**
 * 步序排序键。
 *
 * 步骤不再直接以整数 seq 作为合并基准：两个窗口各自拖动不同步骤时，
 * 小数键可以让两次移动互不冲突地并存（各自插入相邻键中点），
 * seq 只作为展示与拖拽时的派生序号，在落库后统一重排。
 *
 * 浮点键理论上有精度上限，中点逼近后若无法再插入，
 * 会触发一次整组等距重排（rebalance）。
 */

export const KEY_GAP = 1_048_576

/** 为已有顺序的步骤列表分配等距键（序号从 1 起）。 */
export function spreadKeys(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => (index + 1) * KEY_GAP)
}

/**
 * 计算相邻位置中点；prev / next 为 null 表示位于两端。
 * 两端移动会向外扩展一个标准间隔，避免把键压向 0。
 */
export function midpoint(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return KEY_GAP
  if (prev === null) return (next as number) - KEY_GAP
  if (next === null) return prev + KEY_GAP
  return prev + (next - prev) / 2
}

function hasMidpointSpace(prev: number | null, next: number | null): boolean {
  if (prev === null || next === null) return true
  const mid = prev + (next - prev) / 2
  return mid !== prev && mid !== next
}

export interface OrderedKey {
  id: string
  key: number
}

/**
 * 计算把 movedId 移动到 beforeId / afterId 之间所需的键变更。
 *
 * 入参 ordered 为该榫卯全部步骤当前的（标识, 真实 orderKey）升序表——
 * 多次移动后键已是小数、不再等距，因此必须取“真实邻居键”的中点，
 * 不能用序号反推。
 *
 * 通常只改变目标步骤一个键；当相邻键之间已无浮点精度时，
 * 对该榫卯全部步骤按当前顺序等距重排，再在新坐标里插入目标步骤。
 *
 * @returns Map<stepId, orderKey>，包含所有发生变化的步骤
 */
export function assignMoveKeys(
  ordered: OrderedKey[],
  movedId: string,
  beforeId: string | null,
  afterId: string | null,
): Map<string, number> {
  const realKey = (id: string): number => {
    const found = ordered.find((entry) => entry.id === id)
    if (!found) throw new Error(`排序键计算缺少步骤：${id}`)
    return found.key
  }
  const prevKey = beforeId ? realKey(beforeId) : null
  const nextKey = afterId ? realKey(afterId) : null

  if (hasMidpointSpace(prevKey, nextKey)) {
    return new Map([[movedId, midpoint(prevKey, nextKey)]])
  }

  // 中点精度耗尽：先把“除目标外”的步骤等距重排，再把目标插到锚点之间。
  const others = ordered.filter((entry) => entry.id !== movedId)
  const insertAt = beforeId
    ? others.findIndex((entry) => entry.id === beforeId) + 1
    : afterId
      ? others.findIndex((entry) => entry.id === afterId)
      : others.length

  const result = new Map<string, number>()
  others.forEach((entry, index) => result.set(entry.id, (index + 1) * KEY_GAP))
  const prev = insertAt > 0 ? insertAt * KEY_GAP : null
  const next = insertAt < others.length ? (insertAt + 1) * KEY_GAP : null
  result.set(movedId, midpoint(prev, next))
  return result
}

/**
 * 在一串已按 orderKey 升序排列的步骤上，
 * 给出“把 movedId 挪到 fromSeq → toSeq”后的锚点。
 */
export function anchorsForMove(
  ordered: Array<{ id: string }>,
  movedId: string,
  toSeq: number,
): { beforeId: string | null; afterId: string | null } {
  const without = ordered.filter((step) => step.id !== movedId)
  // 序列对外以 1 起；删去自身后插入位置为 toSeq-1。
  const insertAt = Math.min(Math.max(toSeq - 1, 0), without.length)
  const before = insertAt > 0 ? without[insertAt - 1] : null
  const after = insertAt < without.length ? without[insertAt] : null
  return { beforeId: before?.id ?? null, afterId: after?.id ?? null }
}

/** 按 orderKey 升序后重写整数 seq（1 起）。 */
export function resequence<T extends { id: string; orderKey?: number }>(
  steps: T[],
): Array<T & { seq: number }> {
  return [...steps]
    .sort((a, b) => (a.orderKey ?? 0) - (b.orderKey ?? 0) || a.id.localeCompare(b.id))
    .map((step, index) => ({ ...step, seq: index + 1 }))
}

/** 兼容旧数据：缺少 orderKey 的步骤按 seq 等距补齐。 */
export function ensureOrderKeys<T extends { id: string; seq: number; orderKey?: number }>(
  steps: T[],
): Map<string, number> {
  const sorted = [...steps].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
  const keys = spreadKeys(sorted.length)
  const result = new Map<string, number>()
  sorted.forEach((step, index) => {
    if (typeof step.orderKey !== 'number' || !Number.isFinite(step.orderKey)) {
      result.set(step.id, keys[index] as number)
    }
  })
  return result
}
