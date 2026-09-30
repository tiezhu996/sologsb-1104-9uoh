import { create } from 'zustand'
import type { Furniture, FurnitureName } from '../types/furniture'
import type { DimField, EditRecord, FieldProvenance } from '../types/edit'
import type { JointType } from '../types/jointType'
import type { Member } from '../types/member'
import { db, ensureSeedData, SCHEMA_REV } from '../utils/db'
import { createEditId } from '../types/edit'
import { onChange, useSyncStore } from '../utils/sync'

export type JointDraft = Omit<JointType, 'id' | 'schemaRev'>
export type FurnitureDraft = Omit<Furniture, 'id' | 'schemaRev'>

export interface DimensionChange {
  field: DimField
  value: number
  baseValue: number
}

interface JointState {
  joints: JointType[]
  members: Member[]
  furniture: Furniture[]
  stepCounts: Record<string, number>
  selectedJointId: string | null
  loading: boolean
  loadAll: () => Promise<void>
  addJoint: (draft: JointDraft) => Promise<JointType>
  addFurniture: (draft: FurnitureDraft) => Promise<Furniture>
  setSelectedJoint: (id: string) => void
  /** 尺寸修改：记录来源与基准位置，按构件标识进入跨窗口合并。 */
  commitDimension: (memberId: string, change: DimensionChange) => Promise<void>
  renameMember: (memberId: string, name: Member['name']) => Promise<void>
  /** 正在编辑的窗口身份（供来源标签使用）。 */
  currentEditorId: () => string | null
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function buildDimEdit(
  member: Member,
  change: DimensionChange,
  editor: { id: string; label: string },
): EditRecord {
  return {
    id: createEditId(),
    editorId: editor.id,
    editorLabel: editor.label,
    at: Date.now(),
    payload: {
      kind: 'dim',
      memberId: member.id,
      jointTypeId: member.jointTypeId,
      field: change.field,
      value: change.value,
      baseValue: change.baseValue,
    },
  }
}

let loadInFlight: Promise<void> | null = null

export const useJointStore = create<JointState>((set, get) => ({
  joints: [],
  members: [],
  furniture: [],
  stepCounts: {},
  selectedJointId: null,
  loading: false,

  loadAll: async () => {
    // 跨窗口变更可能短时间内多次触发刷新，复用同一次读取。
    if (loadInFlight) return loadInFlight
    set({ loading: true })
    loadInFlight = (async () => {
      try {
        await ensureSeedData()
        const [joints, members, furniture, steps] = await Promise.all([
          db.joints.toArray(),
          db.members.toArray(),
          db.furniture.toArray(),
          db.steps.toArray(),
        ])
        const stepCounts = steps.reduce<Record<string, number>>((counts, step) => {
          counts[step.jointTypeId] = (counts[step.jointTypeId] ?? 0) + 1
          return counts
        }, {})
        const selectedJointId = get().selectedJointId
        set({
          joints: joints.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
          members,
          furniture,
          stepCounts,
          selectedJointId: selectedJointId && joints.some((joint) => joint.id === selectedJointId)
            ? selectedJointId
            : joints[0]?.id ?? null,
        })
      } finally {
        set({ loading: false })
        loadInFlight = null
      }
    })()
    return loadInFlight
  },

  addJoint: async (draft) => {
    const joint: JointType = { ...draft, id: createId('joint'), schemaRev: SCHEMA_REV }
    await db.joints.add(joint)
    set((state) => ({
      joints: [...state.joints, joint].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      selectedJointId: joint.id,
      stepCounts: { ...state.stepCounts, [joint.id]: 0 },
    }))
    return joint
  },

  addFurniture: async (draft) => {
    const furniture: Furniture = { ...draft, id: createId('furniture'), schemaRev: SCHEMA_REV }
    await db.furniture.add(furniture)
    set((state) => ({ furniture: [...state.furniture, furniture] }))
    return furniture
  },

  setSelectedJoint: (id) => set({ selectedJointId: id }),

  currentEditorId: () => useSyncStore.getState().editor?.id ?? null,

  commitDimension: async (memberId, change) => {
    const member = get().members.find((item) => item.id === memberId)
    if (!member) return
    const editor = useSyncStore.getState().editor
    if (!editor) return

    const edit = buildDimEdit(member, change, editor)

    // 乐观更新：先在界面呈现本次修改并带来源，落库结果由合并层 / 重读校正。
    const pendingSource: FieldProvenance = {
      editorId: editor.id,
      editorLabel: editor.label,
      at: edit.at,
      baseValue: change.baseValue,
      revision: (member.revision ?? 0) + 1,
      pending: true,
    }
    set((state) => ({
      members: state.members.map((item) => (
        item.id === memberId
          ? {
              ...item,
              [change.field]: change.value,
              revision: (item.revision ?? 0) + 1,
              dimSources: { ...(item.dimSources ?? {}), [change.field]: pendingSource },
            }
          : item
      )),
    }))

    await useSyncStore.getState().submitEdit(edit, member.jointTypeId)
  },

  renameMember: async (memberId, name) => {
    await db.members.update(memberId, { name })
    set((state) => ({
      members: state.members.map((member) => (
        member.id === memberId ? { ...member, name } : member
      )),
    }))
  },
}))

/**
 * 订阅跨窗口变更：任一窗口的尺寸编辑落库后，相关窗口重读构件与计数。
 * 合并产生的冲突结论以重读结果为准（乐观值若被判定为冲突会被现值校正）。
 */
onChange(() => {
  void useJointStore.getState().loadAll()
})

export type { FurnitureName }
