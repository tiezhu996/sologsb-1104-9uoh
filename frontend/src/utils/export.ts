import { db } from './db'

export interface MortiseExport {
  exportedAt: string
  joints: unknown[]
  members: unknown[]
  steps: unknown[]
  diagrams: unknown[]
  furniture: unknown[]
  edits: unknown[]
  reviews: unknown[]
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function downloadJson(filename: string, payload: unknown): void {
  downloadText(filename, JSON.stringify(payload, null, 2))
}

export async function exportAllData(): Promise<void> {
  const [joints, members, steps, diagrams, furniture, edits, reviews] = await Promise.all([
    db.joints.toArray(),
    db.members.toArray(),
    db.steps.toArray(),
    db.diagrams.toArray(),
    db.furniture.toArray(),
    db.edits.toArray(),
    db.reviews.toArray(),
  ])
  downloadJson(`榫卯图鉴-全部数据-${new Date().toISOString().slice(0, 10)}.json`, {
    exportedAt: new Date().toISOString(),
    joints,
    members,
    steps,
    diagrams,
    furniture,
    edits,
    reviews,
  })
}

export async function exportJointData(jointTypeId: string, jointName: string): Promise<void> {
  const [joint, members, steps, diagrams, furniture] = await Promise.all([
    db.joints.get(jointTypeId),
    db.members.where('jointTypeId').equals(jointTypeId).toArray(),
    db.steps.where('jointTypeId').equals(jointTypeId).toArray(),
    db.diagrams.where('jointTypeId').equals(jointTypeId).toArray(),
    db.furniture.where('jointTypeId').equals(jointTypeId).toArray(),
  ])
  const memberIds = new Set(members.map((member) => member.id))
  const stepIds = new Set(steps.map((step) => step.id))
  const [edits, reviews] = await Promise.all([
    db.edits.toArray().then((all) => all.filter((edit) => (
      edit.payload.kind === 'dim'
        ? memberIds.has(edit.payload.memberId)
        : stepIds.has(edit.payload.stepId)
    ))),
    db.reviews.where('jointTypeId').equals(jointTypeId).toArray(),
  ])
  downloadJson(`榫卯图鉴-${jointName}-${new Date().toISOString().slice(0, 10)}.json`, {
    exportedAt: new Date().toISOString(),
    joints: joint ? [joint] : [],
    members,
    steps,
    diagrams,
    furniture,
    edits,
    reviews,
  })
}
