import { create } from 'zustand'
import type { DisassemblyStep } from '../types/step'
import type { EditRecord, StepProvenance } from '../types/edit'
import { createEditId } from '../types/edit'
import { db } from '../utils/db'
import { anchorsForMove, assignMoveKeys, ensureOrderKeys, resequence } from '../utils/orderKey'
import { useSyncStore, onChange as onSyncChange } from '../utils/sync'

interface StepState {
  steps: DisassemblyStep[]
  currentStepIndex: number
  loading: boolean
  /** 当前已载入的榫卯，用于精确重读。 */
  jointTypeId: string | null
  loadSteps: (jointTypeId: string) => Promise<void>
  moveStep: (from: number, to: number) => Promise<void>
  setCurrentStep: (index: number) => void
}

function sortSteps(steps: DisassemblyStep[]): DisassemblyStep[] {
  return [...steps].sort((a, b) => {
    const keyA = typeof a.orderKey === 'number' ? a.orderKey : a.seq
    const keyB = typeof b.orderKey === 'number' ? b.orderKey : b.seq
    return keyA - keyB || a.id.localeCompare(b.id)
  }).map((step, index) => ({ ...step, seq: index + 1 }))
}

/**
 * 在本地按锚点模拟一次移动，返回新的步骤顺序与目标步骤的新序号。
 * 与合并引擎落库时的 assignMoveKeys 使用同一套规则，
 * 因此乐观结果和最终落库顺序一致。
 */
function simulateMove(steps: DisassemblyStep[], movedId: string, toSeq: number): DisassemblyStep[] {
  const ordered = sortSteps(steps)
  const { beforeId, afterId } = anchorsForMove(ordered, movedId, toSeq)
  const orderedEntries = ordered.map((step) => ({
    id: step.id,
    key: typeof step.orderKey === 'number' ? step.orderKey : step.seq * 1_048_576,
  }))
  const keyChanges = assignMoveKeys(orderedEntries, movedId, beforeId, afterId)
  const next = ordered.map((step) => {
    const key = keyChanges.get(step.id)
    return key !== undefined ? { ...step, orderKey: key } : step
  })
  return resequence(next)
}

export function buildMoveEdit(
  steps: DisassemblyStep[],
  movedId: string,
  fromSeq: number,
  toSeq: number,
  editor: { id: string; label: string },
): { edit: EditRecord; simulated: DisassemblyStep[] } | null {
  const ordered = sortSteps(steps)
  const moved = ordered.find((step) => step.id === movedId)
  if (!moved) return null
  const { beforeId, afterId } = anchorsForMove(ordered, movedId, toSeq)
  const edit: EditRecord = {
    id: createEditId(),
    editorId: editor.id,
    editorLabel: editor.label,
    at: Date.now(),
    payload: {
      kind: 'move',
      stepId: movedId,
      jointTypeId: moved.jointTypeId,
      fromSeq,
      toSeq,
      baseOrderKey: moved.orderKey ?? fromSeq,
      beforeId,
      afterId,
    },
  }
  return { edit, simulated: simulateMove(steps, movedId, toSeq) }
}

export const useStepStore = create<StepState>((set, get) => ({
  steps: [],
  currentStepIndex: 0,
  loading: false,
  jointTypeId: null,

  loadSteps: async (jointTypeId) => {
    set({ loading: true, jointTypeId })
    try {
      const raw = await db.steps.where('jointTypeId').equals(jointTypeId).toArray()
      // 兼容旧数据：内存里补键，不强制写库（迁移时已补过）。
      const missing = ensureOrderKeys(raw)
      if (missing.size > 0) raw.forEach((step) => {
        const key = missing.get(step.id)
        if (key !== undefined) step.orderKey = key
      })
      const steps = sortSteps(raw)
      set((state) => ({
        steps,
        currentStepIndex: Math.min(state.currentStepIndex, Math.max(0, steps.length - 1)),
      }))
    } finally {
      set({ loading: false })
    }
  },

  moveStep: async (from, to) => {
    const ordered = sortSteps(get().steps)
    if (from < 0 || to < 0 || from >= ordered.length || to >= ordered.length || from === to) return
    const moved = ordered[from]
    if (!moved) return
    const editor = useSyncStore.getState().editor
    if (!editor) return

    const toSeq = to + 1
    const built = buildMoveEdit(get().steps, moved.id, from + 1, toSeq, editor)
    if (!built) return

    // 乐观落位：界面先按锚点模拟新顺序并标记来源。
    const simulated = built.simulated.map((step) => (
      step.id === moved.id
        ? {
            ...step,
            revision: (step.revision ?? 0) + 1,
            lastMove: {
              editorId: editor.id,
              editorLabel: editor.label,
              at: built.edit.at,
              baseSeq: from + 1,
              newSeq: step.seq,
              pending: true,
            } satisfies StepProvenance,
          }
        : step
    ))
    set({ steps: simulated, currentStepIndex: to })

    await useSyncStore.getState().submitEdit(built.edit, moved.jointTypeId)
  },

  setCurrentStep: (index) => set({
    currentStepIndex: Math.max(0, index),
  }),
}))

/**
 * 跨窗口变更：任一窗口的移动落库后，如果当前页面正打开该榫卯，
 * 重读步骤。合并后的顺序与待核对结论以数据库为准。
 */
onSyncChange((jointTypeId) => {
  const state = useStepStore.getState()
  if (state.jointTypeId && (jointTypeId === null || jointTypeId === state.jointTypeId)) {
    void state.loadSteps(state.jointTypeId)
  }
})
