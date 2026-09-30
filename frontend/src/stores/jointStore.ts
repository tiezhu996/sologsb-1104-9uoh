import { create } from 'zustand'
import type { ConflictItem } from '../types/change'
import type { Furniture, FurnitureName } from '../types/furniture'
import type { JointType } from '../types/jointType'
import type { Member, MemberName } from '../types/member'
import { commitChange, loadConflicts, makeChange, resolveConflict, retryOutbox } from '../utils/changeLog'
import { db, ensureSeedData } from '../utils/db'

export type JointDraft = Omit<JointType, 'id' | 'schemaRev'>
export type FurnitureDraft = Omit<Furniture, 'id' | 'schemaRev'>

interface JointState {
  joints: JointType[]
  members: Member[]
  furniture: Furniture[]
  conflicts: ConflictItem[]
  stepCounts: Record<string, number>
  selectedJointId: string | null
  loading: boolean
  loadAll: () => Promise<void>
  addJoint: (draft: JointDraft) => Promise<JointType>
  addFurniture: (draft: FurnitureDraft) => Promise<Furniture>
  setSelectedJoint: (id: string) => void
  updateMemberDimensions: (
    memberId: string,
    dimensions: Pick<Member, 'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm'>,
  ) => Promise<void>
  renameMember: (memberId: string, name: Member['name']) => Promise<void>
  resolveConflict: (conflictId: string, chosenValue: number | string) => Promise<void>
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useJointStore = create<JointState>((set, get) => ({
  joints: [],
  members: [],
  furniture: [],
  conflicts: [],
  stepCounts: {},
  selectedJointId: null,
  loading: false,

  loadAll: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      await ensureSeedData()
      await retryOutbox()
      const [joints, members, furniture, steps, conflicts] = await Promise.all([
        db.joints.toArray(),
        db.members.toArray(),
        db.furniture.toArray(),
        db.steps.toArray(),
        loadConflicts(),
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
        conflicts,
        stepCounts,
        selectedJointId: selectedJointId && joints.some((joint) => joint.id === selectedJointId)
          ? selectedJointId
          : joints[0]?.id ?? null,
      })
    } finally {
      set({ loading: false })
    }
  },

  addJoint: async (draft) => {
    const joint: JointType = { ...draft, id: createId('joint'), schemaRev: 2 }
    await db.joints.add(joint)
    set((state) => ({
      joints: [...state.joints, joint].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      selectedJointId: joint.id,
      stepCounts: { ...state.stepCounts, [joint.id]: 0 },
    }))
    return joint
  },

  addFurniture: async (draft) => {
    const furniture: Furniture = { ...draft, id: createId('furniture'), schemaRev: 2 }
    await db.furniture.add(furniture)
    set((state) => ({ furniture: [...state.furniture, furniture] }))
    return furniture
  },

  setSelectedJoint: (id) => set({ selectedJointId: id }),

  updateMemberDimensions: async (memberId, dimensions) => {
    const member = get().members.find((item) => item.id === memberId)
    if (!member) return
    const fields = Object.keys(dimensions) as Array<keyof typeof dimensions>
    for (const field of fields) {
      const baseValue = member[field] as number
      const newValue = dimensions[field] as number
      if (baseValue === newValue) continue
      await commitChange(makeChange({
        recordType: 'member',
        recordId: memberId,
        jointTypeId: member.jointTypeId,
        field,
        baseValue,
        newValue,
      }))
    }
    const [members, conflicts] = await Promise.all([db.members.toArray(), loadConflicts()])
    set({ members, conflicts })
  },

  renameMember: async (memberId, name) => {
    const member = get().members.find((item) => item.id === memberId)
    if (!member || member.name === name) return
    await commitChange(makeChange({
      recordType: 'member',
      recordId: memberId,
      jointTypeId: member.jointTypeId,
      field: 'name',
      baseValue: member.name,
      newValue: name,
    }))
    const [members, conflicts] = await Promise.all([db.members.toArray(), loadConflicts()])
    set({ members, conflicts })
  },

  resolveConflict: async (conflictId, chosenValue) => {
    await resolveConflict(conflictId, chosenValue)
    const [members, conflicts] = await Promise.all([db.members.toArray(), loadConflicts()])
    set({ members, conflicts })
  },
}))

export type { FurnitureName, MemberName }
