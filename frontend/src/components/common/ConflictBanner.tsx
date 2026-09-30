import { useState } from 'react'
import { useJointStore } from '../../stores/jointStore'
import { useStepStore } from '../../stores/stepStore'
import type { ConflictItem } from '../../types/change'
import { formatSourceLabel } from '../../utils/source'

const FIELD_LABELS: Record<string, string> = {
  lengthMm: '长度',
  widthMm: '宽度',
  thicknessMm: '厚度',
  toleranceMm: '配合公差',
  name: '构件名称',
  orderKey: '步序位置',
}

function formatValue(conflict: ConflictItem, value: number | string): string {
  if (conflict.recordType === 'member' && conflict.field !== 'name') {
    return `${Number(value).toFixed(2)} mm`
  }
  if (conflict.field === 'orderKey') {
    return `第 ${Number(value).toFixed(2)} 键位`
  }
  return String(value)
}

function describe(conflict: ConflictItem): string {
  const target = conflict.recordType === 'member' ? '构件尺寸' : '拆装步序'
  const field = FIELD_LABELS[conflict.field] ?? conflict.field
  return `${target} · ${field}`
}

export function ConflictBanner() {
  const conflicts = useJointStore((state) => state.conflicts)
  const resolveConflict = useJointStore((state) => state.resolveConflict)
  const loadAll = useJointStore((state) => state.loadAll)
  const loadSteps = useStepStore((state) => state.loadSteps)
  const [dismissed, setDismissed] = useState(false)

  const open = conflicts.filter((item) => item.status === 'open')
  if (open.length === 0 || dismissed) return null

  const handleResolve = async (conflict: ConflictItem, value: number | string) => {
    await resolveConflict(conflict.id, value)
    await loadAll()
    if (conflict.recordType === 'step') {
      await loadSteps(conflict.jointTypeId)
    }
  }

  return (
    <section
      className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm"
      data-testid="conflict-banner"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <span aria-hidden="true">⚠️</span>
            待核对项 · {open.length} 条记录被两个窗口改过
          </h2>
          <p className="mt-1 text-xs leading-5 text-amber-800/80">
            同一条记录的同一字段被两边改出不同结果，已保留两条来源与基准，未覆盖任何一方。请选择采用哪一边。
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
          onClick={() => setDismissed(true)}
        >
          稍后核对
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {open.map((conflict) => (
          <li
            key={conflict.id}
            className="rounded-xl border border-amber-200 bg-white/90 p-3"
            data-testid="conflict-item"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                {describe(conflict)}
              </span>
              <span>基准：{formatValue(conflict, conflict.baseValue)}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {conflict.options.map((option) => (
                <div
                  key={option.source}
                  className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-stone-700">
                      {formatSourceLabel(option.source)}
                    </p>
                    <p className="text-sm font-semibold text-wood-900">
                      {formatValue(conflict, option.value)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg bg-wood-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-wood-900"
                    onClick={() => void handleResolve(conflict, option.value)}
                  >
                    采用此值
                  </button>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
