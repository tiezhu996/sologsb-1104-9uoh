/**
 * 旧数据升级验证：先用 v1 结构写入老数据（无 revision / orderKey / dimSources），
 * 再用当前 v3 数据库打开，确认原有内容保留、字段补齐、步骤顺序正确。
 */
import 'fake-indexeddb/auto'
import { strict as assert } from 'node:assert'
import Dexie from 'dexie'

let passed = 0

const oldJoint = {
  id: 'joint-old', name: '燕尾榫', family: '出头', difficulty: '入门',
  strengthNote: '老数据', glueNeeded: false,
}
const oldMembers = [
  { id: 'mo-1', jointTypeId: 'joint-old', name: '榫头', part: '出榫件', grainDir: '顺纹', lengthMm: 128, widthMm: 54, thicknessMm: 28, toleranceMm: 0.15, note: '旧构件一' },
  { id: 'mo-2', jointTypeId: 'joint-old', name: '榫眼', part: '受榫件', grainDir: '横纹', lengthMm: 126, widthMm: 52, thicknessMm: 30, toleranceMm: 0.18, note: '旧构件二' },
]
const oldSteps = [
  { id: 'st-2', jointTypeId: 'joint-old', seq: 2, action: '装配', direction: '侧向', tool: '鱼线', riskNote: '第二步', holdSec: 8 },
  { id: 'st-1', jointTypeId: 'joint-old', seq: 1, action: '拆卸', direction: '轴向', tool: '木槌', riskNote: '第一步', holdSec: 6 },
]

async function main() {
  // 1) 用 v1 schema 建库并写入老数据
  const legacy = new Dexie('gbmortise-db')
  legacy.version(1).stores({
    joints: 'id, name, family, difficulty',
    members: 'id, jointTypeId, name, part, lengthMm',
    steps: 'id, jointTypeId, seq, action',
    diagrams: 'id, jointTypeId, stepId, view',
    furniture: 'id, jointTypeId, name',
  })
  await legacy.joints.add(oldJoint)
  await legacy.members.bulkAdd(oldMembers)
  await legacy.steps.bulkAdd(oldSteps)
  await legacy.close()
  console.log('  ✓ v1 老数据写入完成')

  // 2) 用当前 v3 数据库重新打开（触发 v2、v3 升级链）
  const { db } = await import('../src/utils/db')

  const joints = await db.joints.toArray()
  assert.equal(joints.length, 1)
  assert.equal(joints[0]?.id, 'joint-old')
  assert.equal(joints[0]?.strengthNote, '老数据')
  assert.equal(joints[0]?.schemaRev, 3)
  console.log('  ✓ 老榫卯内容原样保留，schemaRev 升至 3')

  const members = await db.members.toArray()
  assert.equal(members.length, 2)
  const mo1 = members.find((m) => m.id === 'mo-1')
  assert.equal(mo1?.note, '旧构件一')
  assert.equal(mo1?.revision, 0)
  assert.deepEqual(mo1?.dimSources, {})
  assert.equal(mo1?.schemaRev, 3)
  console.log('  ✓ 老构件尺寸与备注可用，补齐 revision / dimSources')

  const allSteps = await db.steps.toArray()
  const steps = allSteps.sort((a, b) => (a.orderKey ?? 0) - (b.orderKey ?? 0))
  assert.deepEqual(steps.map((s) => s.id), ['st-1', 'st-2'])
  assert.ok((steps[0]?.orderKey as number) < (steps[1]?.orderKey as number))
  assert.equal(steps[0]?.seq, 1)
  assert.equal(steps[0]?.riskNote, '第一步')
  assert.equal(steps[0]?.revision, 0)
  console.log('  ✓ 老步骤按原顺序补齐 orderKey，整数 seq 不变')

  // 3) 升级后数据仍可参与并发编辑
  const { applyEdit } = await import('../src/utils/merge')
  const outcome = await applyEdit({
    id: 'edit-after-upgrade',
    editorId: 'win-a',
    editorLabel: '窗口甲',
    at: Date.now(),
    payload: { kind: 'dim', memberId: 'mo-1', jointTypeId: 'joint-old', field: 'lengthMm', value: 130, baseValue: 128 },
  })
  assert.equal(outcome.status, 'applied')
  const edited = await db.members.get('mo-1')
  assert.equal(edited?.lengthMm, 130)
  assert.equal(edited?.dimSources?.lengthMm?.editorLabel, '窗口甲')
  console.log('  ✓ 升级后的老记录可继续参与跨窗口编辑')

  const editsCount = await db.edits.count()
  const reviewsCount = await db.reviews.count()
  assert.ok(editsCount >= 1)
  assert.equal(reviewsCount, 0)
  console.log('  ✓ v3 新表在升级库中正常工作')

  await db.close()
  passed = 6
  console.log(`\n全部 ${passed} 项断言通过`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
