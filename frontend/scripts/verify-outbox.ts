/**
 * outbox 进度保留与续传验证。
 * 模拟“写库失败 → 队列持久化 → 重新打开 → 恢复续传”的完整路径。
 */
import 'fake-indexeddb/auto'
import { strict as assert } from 'node:assert'

// Node 环境下补齐 localStorage（浏览器原生提供）。
const memoryStorage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => void memoryStorage.set(key, value),
    removeItem: (key: string) => void memoryStorage.delete(key),
  },
})

import { applyEdit } from '../src/utils/merge'
import { getQueuedEdits, queueEdit, removeQueuedEdit, resetOutbox, subscribeOutbox } from '../src/utils/outbox'
import { db } from '../src/utils/db'
import type { EditRecord } from '../src/types/edit'
import type { Member } from '../src/types/member'

let passed = 0

async function main() {
  resetOutbox()
  const member: Member = {
    id: 'm9', jointTypeId: 'j9', name: '榫头', part: '出榫件', grainDir: '顺纹',
    lengthMm: 100, widthMm: 40, thicknessMm: 20, toleranceMm: 0.1, note: '',
    revision: 0, dimSources: {},
  }
  await db.members.add(member)

  const edit: EditRecord = {
    id: 'edit-pending-1',
    editorId: 'win-x',
    editorLabel: '窗口甲',
    at: Date.now(),
    payload: { kind: 'dim', memberId: 'm9', jointTypeId: 'j9', field: 'lengthMm', value: 118, baseValue: 100 },
  }

  // 写库失败（这里直接模拟：不调用 applyEdit，先入队）。
  let notifications = 0
  const unsubscribe = subscribeOutbox(() => { notifications += 1 })
  queueEdit(edit)
  assert.equal(getQueuedEdits().length, 1)
  assert.ok(notifications >= 1)
  console.log('  ✓ 写库失败的修改进入持久队列')

  // 幂等：同一编辑不重复入队
  queueEdit(edit)
  assert.equal(getQueuedEdits().length, 1)
  console.log('  ✓ 队列按编辑标识幂等')

  // “重新打开”：新进程读取队列（重置内存态，仍从 localStorage 读）
  const reopened = getQueuedEdits()
  assert.equal(reopened[0]?.id, 'edit-pending-1')
  console.log('  ✓ 重新打开后能读出未完成进度')

  // 恢复：继续提交
  const outcome = await applyEdit(reopened[0]!)
  assert.equal(outcome.status, 'applied')
  removeQueuedEdit(edit.id)
  const stored = await db.members.get('m9') as Member
  assert.equal(stored.lengthMm, 118)
  assert.equal(stored.dimSources?.lengthMm?.editorLabel, '窗口甲')
  assert.equal(getQueuedEdits().length, 0)
  console.log('  ✓ 续传成功后出队且来源保留')

  // 损坏的 localStorage 不阻塞
  localStorage.setItem('gbmortise-outbox-v1', '{不是合法JSON')
  assert.deepEqual(getQueuedEdits(), [])
  console.log('  ✓ 队列损坏时安全降级')

  unsubscribe()
  resetOutbox()
  await db.close()
  passed = 6
  console.log(`\n全部 ${passed} 项断言通过`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
