import { create } from 'zustand'
import type { ConflictItem } from '../types/change'
import type { DisassemblyStep } from '../types/step'
import { betweenKeys, commitChange, loadConflicts, makeChange, retryOutbox } from '../utils/changeLog'
import { db } from '../utils/db'

interface StepState {
  steps: DisassemblyStep[]
  conflicts: ConflictItem[]
  currentStepIndex: number
  loading: boolean
  loadSteps: (jointTypeId: string) => Promise<void>
  moveStep: (from: number, to: number) => Promise<void>
  setCurrentStep: (index: number) => void
}

/** 按 orderKey 排序并重排 seq 用于展示。 */
function sortSteps(steps: DisassemblyStep[]): DisassemblyStep[] {
  return [...steps]
    .sort((a, b) => (a.orderKey ?? a.seq) - (b.orderKey ?? b.seq))
    .map((step, index) => ({ ...step, seq: index + 1 }))
}

export const useStepStore = create<StepState>((set, get) => ({
  steps: [],
  conflicts: [],
  currentStepIndex: 0,
  loading: false,

  loadSteps: async (jointTypeId) => {
    set({ loading: true })
    try {
      await retryOutbox()
      const steps = await db.steps.where('jointTypeId').equals(jointTypeId).toArray()
      const conflicts = await loadConflicts()
      set((state) => ({
        steps: sortSteps(steps),
        conflicts,
        currentStepIndex: Math.min(state.currentStepIndex, Math.max(0, steps.length - 1)),
      }))
    } finally {
      set({ loading: false })
    }
  },

  moveStep: async (from, to) => {
    const ordered = sortSteps(get().steps)
    if (from < 0 || to < 0 || from >= ordered.length || to >= ordered.length || from === to) return
    const [moved] = ordered.splice(from, 1)
    if (!moved) return
    const baseOrderKey = moved.orderKey ?? moved.seq
    ordered.splice(to, 0, moved)
    const prev = to > 0 ? (ordered[to - 1].orderKey ?? ordered[to - 1].seq) : null
    const next = to < ordered.length - 1 ? (ordered[to + 1].orderKey ?? ordered[to + 1].seq) : null
    const newOrderKey = betweenKeys(prev, next)

    const result = await commitChange(makeChange({
      recordType: 'step',
      recordId: moved.id,
      jointTypeId: moved.jointTypeId,
      field: 'orderKey',
      baseValue: baseOrderKey,
      newValue: newOrderKey,
    }))

    if (result.status === 'conflict') {
      // 同一步被两边改过：不覆盖，重新读取库中真实顺序
      const steps = await db.steps.where('jointTypeId').equals(moved.jointTypeId).toArray()
      const conflicts = await loadConflicts()
      set({ steps: sortSteps(steps), conflicts, currentStepIndex: to })
      return
    }

    // 应用成功：持久化派生 seq 与新 orderKey
    const resequenced = ordered.map((step, index) => ({
      ...(step.id === moved.id ? { ...step, orderKey: newOrderKey } : step),
      seq: index + 1,
    }))
    set({ steps: resequenced, currentStepIndex: to })
    await db.steps.bulkPut(resequenced)
  },

  setCurrentStep: (index) => set({
    currentStepIndex: Math.max(0, index),
  }),
}))
