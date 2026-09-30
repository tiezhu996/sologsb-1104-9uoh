import type { ChangeRecord, ConflictItem, ConflictOption, RecordType } from '../types/change'
import { db } from './db'
import { getSourceId } from './source'

const OUTBOX_KEY = 'gbmortise-outbox'

/**
 * 待发队列（write-ahead）。写库前先把进度落到 localStorage，
 * 即使 IndexedDB 写库失败也能在下次打开时接着恢复。
 */
function readOutbox(): ChangeRecord[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ChangeRecord[]) : []
  } catch {
    return []
  }
}

function writeOutbox(changes: ChangeRecord[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(changes))
  } catch {
    // localStorage 不可用时仅保留本次内存流程，刷新后无法恢复
  }
}

function removeFromOutbox(changeId: string): void {
  writeOutbox(readOutbox().filter((item) => item.id !== changeId))
}

/** 构造一条带来源与基准的修改。 */
export function makeChange(input: {
  recordType: RecordType
  recordId: string
  jointTypeId: string
  field: string
  baseValue: number | string
  newValue: number | string
}): ChangeRecord {
  return {
    id: `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    source: getSourceId(),
    status: 'pending',
    createdAt: Date.now(),
    ...input,
  }
}

/** 顺序键的中点：拖动某一步只改这一步的 orderKey，不同步骤各自移动不冲突。 */
export function betweenKeys(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return 1
  if (prev == null) return (next as number) - 1
  if (next == null) return prev + 1
  return (prev + next) / 2
}

function readField(record: Record<string, unknown>, field: string): number | string {
  return record[field] as number | string
}

async function readRecord(recordType: RecordType, recordId: string) {
  return recordType === 'member' ? db.members.get(recordId) : db.steps.get(recordId)
}

async function applyField(
  recordType: RecordType,
  recordId: string,
  field: string,
  value: number | string,
): Promise<void> {
  const patch = { [field]: value } as never
  if (recordType === 'member') await db.members.update(recordId, patch)
  else await db.steps.update(recordId, patch)
}

export interface CommitResult {
  status: 'applied' | 'conflict' | 'skipped'
  conflict?: ConflictItem
}

/**
 * 提交一条带来源与基准的修改。
 *
 * 流程：
 * 1. 写本地待发队列（write-ahead），保住进度；
 * 2. 事务内做三路合并判定：库中当前值等于基准值或目标值则无冲突，直接落库；
 * 3. 若同一字段已被别的来源改成不同值，则不覆盖，登记待核对项与两条来源；
 * 4. 落库失败则把修改留在待发队列，供下次打开重试。
 */
export async function commitChange(change: ChangeRecord): Promise<CommitResult> {
  // 幂等：该变更若已处理过，直接收尾
  const existing = await db.changes.get(change.id).catch(() => undefined)
  if (existing) {
    removeFromOutbox(change.id)
    return { status: existing.status === 'conflict' ? 'conflict' : 'applied' }
  }

  // write-ahead：先把进度落到本地，再尝试写库
  const outbox = readOutbox()
  if (!outbox.some((item) => item.id === change.id)) {
    writeOutbox([...outbox, change])
  }

  try {
    let result: CommitResult = { status: 'applied' }
    await db.transaction('rw', [db.members, db.steps, db.changes, db.conflicts], async () => {
      const record = await readRecord(change.recordType, change.recordId)
      if (!record) {
        result = { status: 'skipped' }
        return
      }
      const currentValue = readField(record as unknown as Record<string, unknown>, change.field)
      if (currentValue === change.baseValue || currentValue === change.newValue) {
        // 基准未被他人改动（或已被设为目标值）：无冲突
        await applyField(change.recordType, change.recordId, change.field, change.newValue)
        await db.changes.add({ ...change, status: 'applied' })
        result = { status: 'applied' }
        return
      }

      // 冲突：同一字段已被别的来源改成 currentValue
      const peers = (await db.changes.toArray()).filter(
        (item) =>
          item.recordType === change.recordType &&
          item.recordId === change.recordId &&
          item.field === change.field,
      )
      const peer = peers
        .filter((item) => item.source !== change.source && item.status === 'applied')
        .sort((a, b) => b.createdAt - a.createdAt)[0]

      const options: ConflictOption[] = [
        { source: change.source, value: change.newValue },
        { source: peer?.source ?? '初始数据', value: peer?.newValue ?? currentValue },
      ]
      const conflict: ConflictItem = {
        id: `cf-${change.recordId}-${change.field}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        recordType: change.recordType,
        recordId: change.recordId,
        jointTypeId: change.jointTypeId,
        field: change.field,
        baseValue: change.baseValue,
        options,
        status: 'open',
        createdAt: Date.now(),
      }
      // 不覆盖：保留库中现有值，仅登记待核对项
      await db.conflicts.add(conflict)
      await db.changes.add({ ...change, status: 'conflict' })
      result = { status: 'conflict', conflict }
    })
    // 事务成功，进度可从待发队列移除
    removeFromOutbox(change.id)
    return result
  } catch (err) {
    // 写库失败：保留待发队列中的进度，抛出由调用方提示
    throw err
  }
}

/** 重新打开时重试待发队列中的修改，能接着恢复。 */
export async function retryOutbox(): Promise<void> {
  const pending = readOutbox()
  for (const change of pending) {
    try {
      await commitChange(change)
    } catch {
      // 仍然失败则停止本次重试，保留队列等下次打开
      break
    }
  }
}

/** 读取全部待核对项。 */
export async function loadConflicts(): Promise<ConflictItem[]> {
  return db.conflicts.orderBy('createdAt').toArray()
}

/** 对待核对项做出选择：采用某一条来源的值，并把待核对项标记为已解决。 */
export async function resolveConflict(conflictId: string, chosenValue: number | string): Promise<void> {
  const conflict = await db.conflicts.get(conflictId)
  if (!conflict) return
  await applyField(conflict.recordType, conflict.recordId, conflict.field, chosenValue)
  await db.conflicts.update(conflictId, { status: 'resolved', resolution: chosenValue })
}

/** 取出某条记录上未解决的待核对项。 */
export function conflictsForRecord(
  conflicts: ConflictItem[],
  recordType: RecordType,
  recordId: string,
): ConflictItem[] {
  return conflicts.filter(
    (item) => item.status === 'open' && item.recordType === recordType && item.recordId === recordId,
  )
}
