/**
 * 多窗口同步编排。
 *
 * 职责：
 * 1. 提交编辑：乐观更新由各 store 完成；这里负责调用合并引擎落库，
 *    失败时把编辑留在 outbox 并稍后重试（重新打开应用也会续传）；
 * 2. 跨窗口广播：编辑一经落库即通过 BroadcastChannel 通知其它窗口，
 *    其它窗口不回放数据，只重新读取受影响的记录与待核对项；
 * 3. 心跳名册：记录正在编辑的窗口，供显示“窗口甲 / 窗口乙”与在线徽标。
 *
 * 广播可能错过（窗口休眠、通道暂不可用），因此还有定时兜底：
 * 周期性冲刷 outbox、重读待核对项，并在重新可见时立即执行。
 */

import { create } from 'zustand'
import type { EditRecord, ReviewItem } from '../types/edit'
import { applyEdit, getOpenReviews, resolveReview } from './merge'
import { getQueuedEdits, queueEdit, removeQueuedEdit, subscribeOutbox } from './outbox'
import type { Editor } from './editor'
import { defaultLabel, getCustomLabel } from './editor'

const CHANNEL_NAME = 'gbmortise-sync-v1'
const PRESENCE_KEY = 'gbmortise-presence-v1'
const HEARTBEAT_MS = 3_000
const STALE_MS = 12_000
const TICK_MS = 5_000

interface EditMessage {
  type: 'edit-applied'
  editId: string
  jointTypeId: string
  originEditorId: string
  at: number
}

type SyncMessage = EditMessage

interface PresenceEntry extends Editor {
  at: number
  route: string
}

type ChangeListener = (jointTypeId: string | null) => void
type FlushListener = () => void

const changeListeners = new Set<ChangeListener>()
const flushListeners = new Set<FlushListener>()

/** 数据落库后的变更通知，页面据此重读构件 / 步骤（不回放编辑内容）。 */
export function onChange(listener: ChangeListener): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/** outbox 待写数量变化、或重试完成时通知界面。 */
export function onFlush(listener: FlushListener): () => void {
  flushListeners.add(listener)
  return () => flushListeners.delete(listener)
}

function emitFlush(): void {
  flushListeners.forEach((listener) => listener())
}

function emitChange(jointTypeId: string | null): void {
  changeListeners.forEach((listener) => listener(jointTypeId))
}

/* ---------------- 在线窗口名册（localStorage 心跳） ---------------- */

function readPresence(): PresenceEntry[] {
  try {
    const raw = localStorage.getItem(PRESENCE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PresenceEntry[]) : []
  } catch {
    return []
  }
}

function writePresence(entries: PresenceEntry[]): void {
  try {
    localStorage.setItem(PRESENCE_KEY, JSON.stringify(entries))
  } catch {
    /* 名册不可写不影响编辑 */
  }
}

/** 读取当前在线窗口；默认标签按注册顺序命名为 窗口甲 / 窗口乙…。 */
export function snapshotPeers(selfId: string): Array<Editor & { self: boolean }> {
  const now = Date.now()
  const live = readPresence()
    .filter((entry) => now - entry.at < STALE_MS)
    .sort((a, b) => a.at - b.at)
  const seen = new Map<string, PresenceEntry>()
  live.forEach((entry) => seen.set(entry.id, entry))
  return [...seen.values()].map((entry, index) => ({
    id: entry.id,
    label: entry.label || getCustomLabel() || defaultLabel(index),
    self: entry.id === selfId,
  }))
}

function heartbeat(editor: Editor, route: string): void {
  const now = Date.now()
  const customLabel = getCustomLabel()
  const label = customLabel || editor.label
  const entries = readPresence().filter((entry) => now - entry.at < STALE_MS && entry.id !== editor.id)
  entries.push({ id: editor.id, label, at: now, route })
  writePresence(entries)
}

/* ---------------- 同步状态 store ---------------- */

interface SyncState {
  editor: Editor | null
  peers: Array<Editor & { self: boolean }>
  reviews: ReviewItem[]
  pendingCount: number
  lastError: string | null
  init: (editor: Editor, route: string) => void
  refreshPeers: (route: string) => void
  refreshReviews: () => Promise<void>
  submitEdit: (edit: EditRecord, jointTypeId: string) => Promise<void>
  resolve: (reviewId: string, proposalId: string) => Promise<void>
}

let channel: BroadcastChannel | null = null
let timersStarted = false

export const useSyncStore = create<SyncState>((set, get) => ({
  editor: null,
  peers: [],
  reviews: [],
  pendingCount: 0,
  lastError: null,

  init: (editor, route) => {
    if (get().editor) return
    set({ editor, pendingCount: getQueuedEdits().length })
    heartbeat(editor, route)
    set({ peers: snapshotPeers(editor.id) })
    startTimers(editor)
    void get().refreshReviews()
    // 重新打开应用即续传上次未写库的进度。
    void flushOutbox()
  },

  refreshPeers: (route) => {
    const editor = get().editor
    if (!editor) return
    heartbeat(editor, route)
    set({ peers: snapshotPeers(editor.id) })
  },

  refreshReviews: async () => {
    try {
      const reviews = await getOpenReviews()
      set({ reviews })
    } catch {
      /* 待核对项读取失败时保留上一次结果 */
    }
  },

  submitEdit: async (edit, jointTypeId) => {
    // 先乐观反映在界面，再尝试落库；失败进 outbox，稍后或下次打开续传。
    let queued = false
    try {
      const outcome = await applyEdit(edit)
      if (outcome.status === 'duplicate') return
      if (outcome.status === 'ignored') return
      postMessage({
        type: 'edit-applied',
        editId: edit.id,
        jointTypeId,
        originEditorId: edit.editorId,
        at: Date.now(),
      })
      emitChange(jointTypeId)
      void get().refreshReviews()
    } catch (error) {
      queued = true
      queueEdit(edit)
      set({ lastError: describeError(error) })
    } finally {
      set({ pendingCount: getQueuedEdits().length })
    }
    if (queued) {
      window.setTimeout(() => void flushOutbox(), 1_500)
    }
  },

  resolve: async (reviewId, proposalId) => {
    try {
      const review = await resolveReview(reviewId, proposalId)
      emitChange(review.jointTypeId)
      void get().refreshReviews()
    } catch (error) {
      set({ lastError: describeError(error) })
    }
  },
}))

/* ---------------- outbox 续传 ---------------- */

let flushing = false

async function flushOutbox(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const queued = getQueuedEdits()
    for (const edit of queued) {
      const jointTypeId = edit.payload.kind === 'dim' ? edit.payload.jointTypeId : edit.payload.jointTypeId
      try {
        const outcome = await applyEdit(edit)
        if (outcome.status === 'ignored') {
          removeQueuedEdit(edit.id)
          continue
        }
        removeQueuedEdit(edit.id)
        if (outcome.status !== 'duplicate') {
          postMessage({
            type: 'edit-applied',
            editId: edit.id,
            jointTypeId,
            originEditorId: edit.editorId,
            at: Date.now(),
          })
          emitChange(jointTypeId)
        }
      } catch {
        // 仍然写不进去：保留在队首，等待下一轮 / 下次打开。
        break
      }
    }
  } finally {
    flushing = false
    useSyncStore.setState({ pendingCount: getQueuedEdits().length })
    emitFlush()
    void useSyncStore.getState().refreshReviews()
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '数据库暂不可写，修改已保留在本机，稍后会自动重试。'
}

/* ---------------- 跨窗口通道与定时器 ---------------- */

function postMessage(message: SyncMessage): void {
  try {
    channel?.postMessage(message)
  } catch {
    /* 通道异常时其它窗口靠定时兜底重读 */
  }
}

function startTimers(editor: Editor): void {
  if (timersStarted) return
  timersStarted = true

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const message = event.data
      if (!message || message.type !== 'edit-applied') return
      if (message.originEditorId === useSyncStore.getState().editor?.id) return
      // 不回放编辑本身，按榫卯标识重读已合并的记录与待核对项。
      emitChange(message.jointTypeId)
      void useSyncStore.getState().refreshReviews()
    }
  }

  window.setInterval(() => {
    useSyncStore.getState().refreshPeers(window.location.hash || window.location.pathname)
  }, HEARTBEAT_MS)

  // 兜底：冲刷待写队列 + 重读待核对项，覆盖错过广播的窗口。
  window.setInterval(() => {
    void flushOutbox()
  }, TICK_MS)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      heartbeat(editor, window.location.hash || window.location.pathname)
      useSyncStore.setState({ peers: snapshotPeers(editor.id) })
      void flushOutbox()
    }
  })
  window.addEventListener('focus', () => void flushOutbox())
  window.addEventListener('online', () => void flushOutbox())
  window.addEventListener('beforeunload', () => heartbeat(editor, window.location.hash || window.location.pathname))

  subscribeOutbox(() => {
    useSyncStore.setState({ pendingCount: getQueuedEdits().length })
  })
}
