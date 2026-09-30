/**
 * 待写库队列（outbox）。
 *
 * 编辑记录先乐观反映到界面，再尝试写入 IndexedDB；
 * 一旦写库失败（磁盘满、浏览器隐私模式异常、事务中断等），
 * 记录原样保存在 localStorage 中，界面标记“待写库”，
 * 重新打开应用后自动取出继续提交，进度不丢失。
 *
 * localStorage 同样不可用时退回内存队列（仅保证本次会话）。
 */

import type { EditRecord } from '../types/edit'

const STORAGE_KEY = 'gbmortise-outbox-v1'

type Listener = () => void

let memoryQueue: EditRecord[] = []
const listeners = new Set<Listener>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeRaw(value: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, value)
    return true
  } catch {
    return false
  }
}

function load(): EditRecord[] {
  const raw = readRaw()
  if (!raw) return memoryQueue
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      memoryQueue = parsed.filter(isEditRecord)
      return memoryQueue
    }
  } catch {
    /* 损坏的队列不阻塞应用 */
  }
  return memoryQueue
}

function isEditRecord(value: unknown): value is EditRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.payload === 'object'
}

function persist(): boolean {
  return writeRaw(JSON.stringify(memoryQueue))
}

export function getQueuedEdits(): EditRecord[] {
  return load()
}

export function queuedCount(): number {
  return load().length
}

export function queueEdit(edit: EditRecord): void {
  memoryQueue = load()
  if (memoryQueue.some((item) => item.id === edit.id)) return
  memoryQueue = [...memoryQueue, edit]
  persist()
  notify()
}

/** 某条记录成功写库后出队。 */
export function removeQueuedEdit(editId: string): void {
  const next = load().filter((item) => item.id !== editId)
  if (next.length === memoryQueue.length) return
  memoryQueue = next
  persist()
  notify()
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 单元测试 / 调试用清空。 */
export function resetOutbox(): void {
  memoryQueue = []
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
  notify()
}
