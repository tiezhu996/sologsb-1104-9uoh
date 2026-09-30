/**
 * 并发编辑合并引擎。
 *
 * 所有尺寸修改与步序移动都以 EditRecord 的形式进入同一个事务：
 *
 * - 按记录标识（memberId / stepId）在 edits 表幂等去重；
 * - 用“基准值 vs 当前值”做三路判断：
 *   - 基准仍等于当前值（含同窗口连续修改）→ 直接接受，记录来源；
 *   - 基准已被另一窗口改掉且本次又改同一处 → 不覆盖，
 *     生成 / 更新一条待核对项，保留已落地方案与冲突双方来源。
 * - 尺寸按字段独立判断：窗口甲改长、窗口乙改厚可以自动合并；
 * - 步骤移动用 orderKey 锚点：不同步骤的移动各自插入中点，互不干扰；
 *   同一步骤两边都移动才登记待核对。
 */

import { db } from './db'
import { assignMoveKeys, ensureOrderKeys, resequence } from './orderKey'
import type {
  DimEditPayload,
  DimProposal,
  DimReviewItem,
  EditRecord,
  FieldProvenance,
  MoveEditPayload,
  MoveProposal,
  MoveReviewItem,
  ReviewItem,
} from '../types/edit'
import type { DisassemblyStep } from '../types/step'

export type ApplyOutcome =
  | { status: 'applied'; editId: string }
  | { status: 'duplicate'; editId: string }
  | { status: 'conflict'; reviewId: string; editId: string }
  | { status: 'ignored'; editId: string; reason: 'record-missing' }

function dimReviewId(memberId: string, field: string): string {
  return `review-dim-${memberId}-${field}`
}

function moveReviewId(stepId: string): string {
  return `review-move-${stepId}`
}

function toDimProposal(edit: EditRecord, payload: DimEditPayload): DimProposal {
  return {
    editId: edit.id,
    editorId: edit.editorId,
    editorLabel: edit.editorLabel,
    at: edit.at,
    value: payload.value,
    baseValue: payload.baseValue,
  }
}

function toMoveProposal(edit: EditRecord, payload: MoveEditPayload): MoveProposal {
  return {
    editId: edit.id,
    editorId: edit.editorId,
    editorLabel: edit.editorLabel,
    at: edit.at,
    fromSeq: payload.fromSeq,
    toSeq: payload.toSeq,
    beforeId: payload.beforeId,
    afterId: payload.afterId,
  }
}

/** 合并入口。返回结果用于调用方决定广播与界面刷新。 */
export async function applyEdit(edit: EditRecord): Promise<ApplyOutcome> {
  if (edit.payload.kind === 'dim') return applyDimEdit(edit)
  return applyMoveEdit(edit)
}

async function applyDimEdit(edit: EditRecord): Promise<ApplyOutcome> {
  const payload = edit.payload as DimEditPayload
  return db.transaction('rw', [db.edits, db.members, db.reviews], async () => {
    if (await db.edits.get(edit.id)) return { status: 'duplicate', editId: edit.id }

    const member = await db.members.get(payload.memberId)
    if (!member) return { status: 'ignored', editId: edit.id, reason: 'record-missing' }

    await db.edits.add({ ...edit, appliedAt: Date.now() })

    const currentValue = member[payload.field]
    const revision = (member.revision ?? 0) + 1
    const incoming = toDimProposal(edit, payload)
    const source: FieldProvenance = {
      editorId: edit.editorId,
      editorLabel: edit.editorLabel,
      at: edit.at,
      baseValue: payload.baseValue,
      revision,
      resolvedFrom: payload.resolvedFrom,
    }

    // 基准仍等于现值：没有人改过这个字段（同窗口连续修改同样满足）。
    if (currentValue === payload.baseValue) {
      member[payload.field] = payload.value
      member.revision = revision
      member.dimSources = { ...(member.dimSources ?? {}), [payload.field]: source }
      await db.members.put(member)
      return { status: 'applied', editId: edit.id }
    }

    // 该字段已被别的窗口改过：登记待核对，不覆盖现值。
    const reviewId = dimReviewId(payload.memberId, payload.field)
    const existing = await db.reviews.get(reviewId) as DimReviewItem | undefined
    const lastSource = member.dimSources?.[payload.field]
    const applied: DimProposal = existing?.applied ?? {
      editId: `applied-${reviewId}`,
      editorId: lastSource?.editorId ?? 'unknown',
      editorLabel: lastSource?.editorLabel ?? '其他窗口',
      at: lastSource?.at ?? edit.at,
      value: currentValue,
      baseValue: lastSource?.baseValue ?? currentValue,
    }

    const others = existing?.proposals ?? []
    const proposals = [
      ...others.filter((proposal) => proposal.editorId !== edit.editorId),
      incoming,
    ].sort((a, b) => a.at - b.at)

    const now = Date.now()
    const review: DimReviewItem = existing
      ? { ...existing, proposals, status: 'open', updatedAt: now, resolvedAt: undefined, chosenEditorId: undefined }
      : {
          id: reviewId,
          kind: 'dim',
          status: 'open',
          jointTypeId: payload.jointTypeId,
          recordId: payload.memberId,
          field: payload.field,
          applied,
          proposals,
          createdAt: now,
          updatedAt: now,
        }
    await db.reviews.put(review)
    return { status: 'conflict', reviewId, editId: edit.id }
  })
}

/** 规整某榫卯的步骤顺序：补齐 orderKey、升序后统一整数 seq。 */
async function normalizeJointSteps(jointTypeId: string): Promise<DisassemblyStep[]> {
  const steps = await db.steps.where('jointTypeId').equals(jointTypeId).toArray()
  const missing = ensureOrderKeys(steps)
  if (missing.size > 0) {
    await Promise.all([...missing.entries()].map(async ([id, key]) => {
      await db.steps.update(id, { orderKey: key } as Partial<DisassemblyStep>)
      const step = steps.find((item) => item.id === id)
      if (step) step.orderKey = key
    }))
  }
  const ordered = resequence(steps)
  await db.steps.bulkPut(ordered)
  return ordered
}

interface MoveResolutionOptions {
  /** 裁决重放时使用，跳过普通冲突判定。 */
  force?: boolean
  resolvedFrom?: string
}

async function applyMoveEdit(edit: EditRecord, options: MoveResolutionOptions = {}): Promise<ApplyOutcome> {
  const payload = edit.payload as MoveEditPayload
  return db.transaction('rw', [db.edits, db.steps, db.reviews], async () => {
    if (!options.force && await db.edits.get(edit.id)) return { status: 'duplicate', editId: edit.id }

    const ordered = await normalizeJointSteps(payload.jointTypeId)
    const moved = ordered.find((step) => step.id === payload.stepId)
    if (!moved) return { status: 'ignored', editId: edit.id, reason: 'record-missing' }

    if (!options.force) await db.edits.add({ ...edit, appliedAt: Date.now() })

    // 判定基准：同一步骤还停留在拖动发起时的位置（同窗口连续拖动也满足）。
    const baseStillValid = moved.orderKey === payload.baseOrderKey

    if (baseStillValid || options.force) {
      const orderedEntries = ordered.map((step) => ({
        id: step.id,
        key: typeof step.orderKey === 'number' ? step.orderKey : step.seq * 1_048_576,
      }))
      const keyChanges = assignMoveKeys(
        orderedEntries,
        payload.stepId,
        payload.beforeId,
        payload.afterId,
      )
      const revision = (moved.revision ?? 0) + 1
      for (const step of ordered) {
        const key = keyChanges.get(step.id)
        if (key !== undefined) step.orderKey = key
        if (step.id === payload.stepId) {
          step.revision = revision
          step.lastMove = {
            editorId: edit.editorId,
            editorLabel: edit.editorLabel,
            at: edit.at,
            baseSeq: payload.fromSeq,
            newSeq: payload.toSeq,
            resolvedFrom: options.resolvedFrom ?? payload.resolvedFrom,
          }
        }
      }
      const finalOrdered = resequence(ordered)
      await db.steps.bulkPut(finalOrdered)
      return { status: 'applied', editId: edit.id }
    }

    // 该步骤已被别的窗口移动过：登记待核对，保留双方的目标位置与来源。
    const reviewId = moveReviewId(payload.stepId)
    const existing = await db.reviews.get(reviewId) as MoveReviewItem | undefined
    const lastMove = moved.lastMove
    const currentSeq = moved.seq
    const applied: MoveProposal = existing?.applied ?? {
      editId: `applied-${reviewId}`,
      editorId: lastMove?.editorId ?? 'unknown',
      editorLabel: lastMove?.editorLabel ?? '其他窗口',
      at: lastMove?.at ?? edit.at,
      fromSeq: lastMove?.baseSeq ?? currentSeq,
      toSeq: currentSeq,
      beforeId: null,
      afterId: null,
    }
    const incoming = toMoveProposal(edit, payload)
    const proposals = [
      ...(existing?.proposals ?? []).filter((proposal) => proposal.editorId !== edit.editorId),
      incoming,
    ].sort((a, b) => a.at - b.at)

    const now = Date.now()
    const review: MoveReviewItem = existing
      ? { ...existing, proposals, status: 'open', updatedAt: now, resolvedAt: undefined, chosenEditorId: undefined }
      : {
          id: reviewId,
          kind: 'move',
          status: 'open',
          jointTypeId: payload.jointTypeId,
          recordId: payload.stepId,
          applied,
          proposals,
          createdAt: now,
          updatedAt: now,
        }
    await db.reviews.put(review)
    return { status: 'conflict', reviewId, editId: edit.id }
  })
}

/**
 * 裁决一条待核对项。chosenProposalId 采用某一方的方案；
 * 裁决动作本身也作为一次带来源的编辑写日志，便于追溯。
 */
export async function resolveReview(reviewId: string, chosenProposalId: string): Promise<ReviewItem> {
  const review = await db.reviews.get(reviewId)
  if (!review) throw new Error(`待核对项不存在：${reviewId}`)
  if (review.kind === 'dim') return resolveDimReview(review, chosenProposalId)
  return resolveMoveReview(review, chosenProposalId)
}

async function resolveDimReview(review: DimReviewItem, chosenProposalId: string): Promise<DimReviewItem> {
  return db.transaction('rw', [db.edits, db.members, db.reviews], async () => {
    const member = await db.members.get(review.recordId)
    if (!member) throw new Error('待核对的构件已不存在')

    const chosen = [...review.proposals, review.applied].find((item) => item.editId === chosenProposalId)
    if (!chosen) throw new Error('所选方案不存在')

    const now = Date.now()
    const revision = (member.revision ?? 0) + 1
    // “采用当前方案”时以数据库现值为准——冲突期间该窗口可能又连续修过；
    // 历史提议则采用其快照值。
    const chosenValue = chosen.editId === review.applied.editId ? member[review.field] : chosen.value
    member[review.field] = chosenValue
    member.revision = revision
    member.dimSources = {
      ...(member.dimSources ?? {}),
      [review.field]: {
        editorId: chosen.editorId,
        editorLabel: chosen.editorLabel,
        at: now,
        baseValue: chosen.baseValue,
        revision,
        resolvedFrom: 'review',
      } satisfies FieldProvenance,
    }
    await db.members.put(member)

    const closed: DimReviewItem = {
      ...review,
      status: 'resolved',
      resolvedAt: now,
      chosenEditorId: chosen.editorId,
      updatedAt: now,
    }
    await db.reviews.put(closed)
    return closed
  })
}

async function resolveMoveReview(review: MoveReviewItem, chosenProposalId: string): Promise<MoveReviewItem> {
  const chosen = [...review.proposals, review.applied].find((item) => item.editId === chosenProposalId)
  if (!chosen) throw new Error('所选方案不存在')

  // 裁决意图以“当前局面下放到第几位”解释，因此锚点按当前顺序重算，
  // 这样即便冲突期间其它步骤又各自移动过，也能正确落到目标序号。
  const steps = await db.steps.where('jointTypeId').equals(review.jointTypeId).toArray()
  const ordered = resequence(steps)
  const current = ordered.find((step) => step.id === review.recordId)
  if (!current) throw new Error('待核对的步骤已不存在')
  const insertAt = Math.min(Math.max(chosen.toSeq - 1, 0), ordered.length - 1)
  const without = ordered.filter((step) => step.id !== review.recordId)
  const before = insertAt > 0 ? without[insertAt - 1] : null
  const after = insertAt < without.length ? without[insertAt] : null

  const resolutionEdit: EditRecord = {
    id: `edit-resolve-${review.id}-${Date.now().toString(36)}`,
    editorId: chosen.editorId,
    editorLabel: chosen.editorLabel,
    at: Date.now(),
    appliedAt: Date.now(),
    payload: {
      kind: 'move',
      stepId: review.recordId,
      jointTypeId: review.jointTypeId,
      fromSeq: current.seq,
      toSeq: chosen.toSeq,
      baseOrderKey: current.orderKey ?? 0,
      beforeId: before?.id ?? null,
      afterId: after?.id ?? null,
      resolvedFrom: 'review',
    },
  }

  const result = await applyMoveEdit(resolutionEdit, { force: true, resolvedFrom: 'review' })
  if (result.status !== 'applied') throw new Error('裁决移动未能落库')

  const now = Date.now()
  const closed: MoveReviewItem = {
    ...review,
    status: 'resolved',
    resolvedAt: now,
    chosenEditorId: chosen.editorId,
    updatedAt: now,
  }
  await db.reviews.put(closed)
  return closed
}

export async function getOpenReviews(jointTypeId?: string): Promise<ReviewItem[]> {
  const collection = db.reviews.where('status').equals('open')
  const items = await collection.toArray()
  return (jointTypeId ? items.filter((item) => item.jointTypeId === jointTypeId) : items)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
