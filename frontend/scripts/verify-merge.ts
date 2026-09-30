/**
 * 合并引擎与排序键的运行时验证（node + fake-indexeddb）。
 * 仅用于本地核验，不进入应用产物。
 */
import 'fake-indexeddb/auto'

import { strict as assert } from 'node:assert'
import {
  KEY_GAP,
  anchorsForMove,
  assignMoveKeys,
  ensureOrderKeys,
  midpoint,
  resequence,
  spreadKeys,
} from '../src/utils/orderKey'
import { applyEdit, getOpenReviews, resolveReview } from '../src/utils/merge'
import { db } from '../src/utils/db'
import type { EditRecord } from '../src/types/edit'
import type { DisassemblyStep } from '../src/types/step'
import type { Member } from '../src/types/member'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/* ---------------- 排序键性质 ---------------- */

function orderKeyTests() {
  check('等距布键递增且间隔固定', () => {
    const keys = spreadKeys(3)
    assert.deepEqual(keys, [KEY_GAP, KEY_GAP * 2, KEY_GAP * 3])
  })

  check('中点严格落在相邻键之间', () => {
    const mid = midpoint(KEY_GAP, KEY_GAP * 2)
    assert.ok(mid > KEY_GAP && mid < KEY_GAP * 2)
    assert.equal(mid, KEY_GAP * 1.5)
  })

  check('两端插入向外扩展间隔', () => {
    assert.equal(midpoint(null, KEY_GAP), 0)
    assert.equal(midpoint(KEY_GAP, null), KEY_GAP * 2)
  })

  check('反复在前插中点仍保持严格序', () => {
    let prev: number | null = null
    let next: number | null = KEY_GAP
    const seq: number[] = []
    for (let i = 0; i < 30; i += 1) {
      const key = midpoint(prev, next)
      assert.ok(prev === null || key > prev)
      assert.ok(next === null || key < next)
      seq.push(key)
      next = key
    }
    assert.equal(new Set(seq).size, seq.length)
  })

  check('不同步骤的两次移动可并存（锚点各自成立）', () => {
    // A B C D；第一次把 C 移到最前，第二次（在新顺序上）把 B 移到最后
    const ids = ['a', 'b', 'c', 'd']
    const initial = ids.map((id, i) => ({ id, key: (i + 1) * KEY_GAP }))
    const m1 = anchorsForMove(initial.map(({ id }) => ({ id })), 'c', 1)
    const k1 = assignMoveKeys(initial, 'c', m1.beforeId, m1.afterId)
    // 在结果序列 C A B D 上移动 B 到最后
    const afterFirst = initial
      .map((entry) => ({ id: entry.id, key: k1.get(entry.id) ?? entry.key }))
      .sort((x, y) => x.key - y.key)
    const m2 = anchorsForMove(afterFirst.map(({ id }) => ({ id })), 'b', 4)
    const k2 = assignMoveKeys(afterFirst, 'b', m2.beforeId, m2.afterId)
    const finalKeys = new Map<string, number>(afterFirst.map((entry) => [entry.id, entry.key]))
    k2.forEach((key, id) => finalKeys.set(id, key))
    const finalOrder = [...finalKeys.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id)
    assert.deepEqual(finalOrder, ['c', 'a', 'd', 'b'])
  })

  check('旧数据按 seq 补键', () => {
    const legacy = [
      { id: 'x', seq: 2 },
      { id: 'y', seq: 1 },
    ]
    const patch = ensureOrderKeys(legacy)
    assert.ok((patch.get('y') as number) < (patch.get('x') as number))
  })

  check('resequence 输出 1 起连续序号', () => {
    const out = resequence([
      { id: 'a', orderKey: 0.5 },
      { id: 'b', orderKey: 0.2 },
    ])
    assert.deepEqual(out.map((x) => [x.id, x.seq]), [['b', 1], ['a', 2]])
  })
}

/* ---------------- 构造测试数据 ---------------- */

async function seed() {
  const member: Member = {
    id: 'm1', jointTypeId: 'j1', name: '榫头', part: '出榫件', grainDir: '顺纹',
    lengthMm: 100, widthMm: 40, thicknessMm: 20, toleranceMm: 0.1, note: '',
    revision: 0, dimSources: {},
  }
  const stepData: Array<Partial<DisassemblyStep>> = [
    { id: 's1' }, { id: 's2' }, { id: 's3' },
  ]
  const steps: DisassemblyStep[] = (['s1', 's2', 's3'] as const).map((sid, i) => ({
    id: sid,
    jointTypeId: 'j1',
    seq: i + 1,
    action: '拆卸' as const,
    direction: '轴向' as const,
    tool: '木槌' as const,
    riskNote: '',
    holdSec: 5,
    orderKey: (i + 1) * KEY_GAP,
    revision: 0,
  }))
  void stepData
  await db.members.add(member)
  await db.steps.bulkAdd(steps)
  return { member, steps }
}

function dimEdit(over: {
  id: string
  editor: { id: string; label: string }
  field?: 'lengthMm' | 'widthMm'
  value: number
  base: number
}): EditRecord {
  return {
    id: over.id,
    editorId: over.editor.id,
    editorLabel: over.editor.label,
    at: Date.now(),
    payload: {
      kind: 'dim',
      memberId: 'm1',
      jointTypeId: 'j1',
      field: over.field ?? 'lengthMm',
      value: over.value,
      baseValue: over.base,
    },
  }
}

async function moveEdit(over: {
  id: string
  editor: { id: string; label: string }
  stepId: string
  fromSeq: number
  toSeq: number
  baseOrderKey: number
  beforeId: string | null
  afterId: string | null
}): Promise<EditRecord> {
  return {
    id: over.id,
    editorId: over.editor.id,
    editorLabel: over.editor.label,
    at: Date.now(),
    payload: {
      kind: 'move',
      stepId: over.stepId,
      jointTypeId: 'j1',
      fromSeq: over.fromSeq,
      toSeq: over.toSeq,
      baseOrderKey: over.baseOrderKey,
      beforeId: over.beforeId,
      afterId: over.afterId,
    },
  }
}

/* ---------------- 合并引擎场景 ---------------- */

const winA = { id: 'a', label: '窗口甲' }
const winB = { id: 'b', label: '窗口乙' }

async function mergeTests() {
  await seed()

  await checkAsync('不同字段并发修改自动合并、互不覆盖', async () => {
    const r1 = await applyEdit(dimEdit({ id: 'e1', editor: winA, field: 'lengthMm', value: 110, base: 100 }))
    const r2 = await applyEdit(dimEdit({ id: 'e2', editor: winB, field: 'widthMm', value: 44, base: 40 }))
    assert.equal(r1.status, 'applied')
    assert.equal(r2.status, 'applied')
    const member = await db.members.get('m1') as Member
    assert.equal(member.lengthMm, 110)
    assert.equal(member.widthMm, 44)
    assert.equal(member.dimSources?.lengthMm?.editorId, 'a')
    assert.equal(member.dimSources?.widthMm?.editorId, 'b')
    assert.equal(member.dimSources?.lengthMm?.baseValue, 100)
  })

  await checkAsync('同字段基于过期基准的修改登记待核对且不覆盖', async () => {
    // 当前 lengthMm=110；窗口乙仍以旧基准 100 改成 120
    const result = await applyEdit(dimEdit({ id: 'e3', editor: winB, field: 'lengthMm', value: 120, base: 100 }))
    assert.equal(result.status, 'conflict')
    const member = await db.members.get('m1') as Member
    assert.equal(member.lengthMm, 110) // 现值保留甲方
    const reviews = await getOpenReviews('j1')
    const review = reviews.find((r) => r.id === 'review-dim-m1-lengthMm')
    assert.ok(review && review.kind === 'dim')
    if (review?.kind !== 'dim') throw new Error('类型收窄')
    assert.equal(review.applied.editorId, 'a')
    assert.equal(review.applied.value, 110)
    assert.equal(review.proposals[0]?.editorId, 'b')
    assert.equal(review.proposals[0]?.value, 120)
  })

  await checkAsync('同一窗口连续修改视为同链，直接接受', async () => {
    // 窗口甲基于现值 110 再改
    const result = await applyEdit(dimEdit({ id: 'e4', editor: winA, field: 'lengthMm', value: 112, base: 110 }))
    assert.equal(result.status, 'applied')
    const member = await db.members.get('m1') as Member
    assert.equal(member.lengthMm, 112)
  })

  await checkAsync('同一窗口重复提交幂等', async () => {
    const result = await applyEdit(dimEdit({ id: 'e4', editor: winA, field: 'lengthMm', value: 112, base: 110 }))
    assert.equal(result.status, 'duplicate')
  })

  await checkAsync('冲突中同窗口更新自己的提议不堆叠', async () => {
    // 乙再次基于 110 提交新值 121
    const result = await applyEdit(dimEdit({ id: 'e5', editor: winB, field: 'lengthMm', value: 121, base: 110 }))
    assert.equal(result.status, 'conflict')
    const reviews = await getOpenReviews('j1')
    const review = reviews.find((r) => r.id === 'review-dim-m1-lengthMm')
    if (review?.kind !== 'dim') throw new Error('类型收窄')
    const bProposals = review.proposals.filter((p) => p.editorId === 'b')
    assert.equal(bProposals.length, 1)
    assert.equal(bProposals[0]?.value, 121)
  })

  await checkAsync('裁决采用乙方方案后待核对关闭并写入来源', async () => {
    const reviews = await getOpenReviews('j1')
    const review = reviews.find((r) => r.id === 'review-dim-m1-lengthMm')
    if (review?.kind !== 'dim') throw new Error('类型收窄')
    const bProposal = review.proposals.find((p) => p.editorId === 'b')
    assert.ok(bProposal)
    await resolveReview(review.id, bProposal!.editId)
    const member = await db.members.get('m1') as Member
    assert.equal(member.lengthMm, 121)
    assert.equal(member.dimSources?.lengthMm?.resolvedFrom, 'review')
    const after = await getOpenReviews('j1')
    assert.equal(after.some((r) => r.id === review.id), false)
  })

  await checkAsync('裁决采用当前（甲）方案同样关闭', async () => {
    // 再造一次冲突：甲先基于现值 121 改到 130，乙再以旧基准 121 改到 140
    await applyEdit(dimEdit({ id: 'e6', editor: winA, field: 'lengthMm', value: 130, base: 121 }))
    const conflict = await applyEdit(dimEdit({ id: 'e7', editor: winB, field: 'lengthMm', value: 140, base: 121 }))
    assert.equal(conflict.status, 'conflict')
    const reviews = await getOpenReviews('j1')
    const review = reviews.find((r) => r.id === 'review-dim-m1-lengthMm')
    if (review?.kind !== 'dim') throw new Error('类型收窄')
    await resolveReview(review.id, review.applied.editId)
    const member = await db.members.get('m1') as Member
    assert.equal(member.lengthMm, 130)
  })

  /* ---- 移动 ---- */

  async function orderedIds(): Promise<string[]> {
    const steps = await db.steps.where('jointTypeId').equals('j1').toArray()
    return resequence(steps).map((s) => s.id)
  }

  await checkAsync('不同步骤各自移动自动合并', async () => {
    // s3 移到第 1 位：before=null, after=s1
    const edit1 = await moveEdit({
      id: 'm-e1', editor: winA, stepId: 's3', fromSeq: 3, toSeq: 1,
      baseOrderKey: KEY_GAP * 3, beforeId: null, afterId: 's1',
    })
    const r1 = await applyEdit(edit1)
    assert.equal(r1.status, 'applied')
    const order1 = await orderedIds()
    assert.deepEqual(order1, ['s3', 's1', 's2'])

    // 乙在甲移动后的新顺序 [s3,s1,s2] 上把 s2 移到第 2 位
    const s2Step = await db.steps.get('s2') as DisassemblyStep
    const edit2 = await moveEdit({
      id: 'm-e2', editor: winB, stepId: 's2', fromSeq: 3, toSeq: 2,
      baseOrderKey: s2Step.orderKey as number, beforeId: 's3', afterId: 's1',
    })
    const r2 = await applyEdit(edit2)
    assert.equal(r2.status, 'applied')
    const order2 = await orderedIds()
    assert.deepEqual(order2, ['s3', 's2', 's1'])
  })

  await checkAsync('同一步骤两边移动登记待核对，不覆盖顺序', async () => {
    // 当前顺序 s3 s2 s1；把 s1 移到第 1（甲，基于现状）
    const current = await orderedIds()
    const s1Pos = current.indexOf('s1') + 1
    const s1Key = (await db.steps.get('s1') as DisassemblyStep).orderKey as number
    const editA = await moveEdit({
      id: 'm-e3', editor: winA, stepId: 's1', fromSeq: s1Pos, toSeq: 1,
      baseOrderKey: s1Key, beforeId: null, afterId: 's3',
    })
    assert.equal((await applyEdit(editA)).status, 'applied')
    const afterA = await orderedIds()
    assert.deepEqual(afterA, ['s1', 's3', 's2'])

    // 乙基于过期基准（s1 还在第 3 位、旧键 3*GAP）把 s1 移到第 2 位
    const editB = await moveEdit({
      id: 'm-e4', editor: winB, stepId: 's1', fromSeq: 3, toSeq: 2,
      baseOrderKey: KEY_GAP * 3, beforeId: 's3', afterId: 's2',
    })
    const result = await applyEdit(editB)
    assert.equal(result.status, 'conflict')
    // 甲方顺序保留
    assert.deepEqual(await orderedIds(), ['s1', 's3', 's2'])
    const reviews = await getOpenReviews('j1')
    const review = reviews.find((r) => r.kind === 'move' && r.recordId === 's1')
    assert.ok(review)
    if (review?.kind !== 'move') throw new Error('类型收窄')
    assert.equal(review.applied.editorId, 'a')
    assert.equal(review.proposals[0]?.toSeq, 2)
  })

  await checkAsync('移动冲突裁决后落到乙方目标序号', async () => {
    const reviews = await getOpenReviews('j1')
    const review = reviews.find((r) => r.kind === 'move' && r.recordId === 's1')
    if (review?.kind !== 'move') throw new Error('类型收窄')
    const bProposal = review.proposals.find((p) => p.editorId === 'b')
    assert.ok(bProposal)
    await resolveReview(review.id, bProposal!.editId)
    // 乙的意图：s1 在第 2 位
    const order = await orderedIds()
    assert.equal(order.indexOf('s1'), 1)
    const step = await db.steps.get('s1') as DisassemblyStep
    assert.equal(step.seq, 2)
    assert.equal(step.lastMove?.resolvedFrom, 'review')
    assert.equal((await getOpenReviews('j1')).some((r) => r.id === review.id), false)
  })

  await checkAsync('编辑日志保留两条来源', async () => {
    const edits = await db.edits.toArray()
    const editors = new Set(edits.map((e) => e.editorId))
    assert.ok(editors.has('a') && editors.has('b'))
    assert.ok(edits.length >= 8)
  })
}

async function main() {
  console.log('orderKey:')
  orderKeyTests()
  console.log('merge engine:')
  await mergeTests()
  await db.close()
  console.log(`\n全部 ${passed} 项断言通过`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
