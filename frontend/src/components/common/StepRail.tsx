import type { DragEvent, ReactNode } from 'react'
import type { DisassemblyStep } from '../../types/step'

interface StepRailProps {
  steps: DisassemblyStep[]
  currentIndex: number
  onSelect: (index: number) => void
  onMove: (from: number, to: number) => void
  /** 步序来源 / 待核对标记等附加信息。 */
  renderStepMeta?: (step: DisassemblyStep) => ReactNode
  /** 处于待核对状态的步骤标识集合。 */
  conflictStepIds?: Set<string>
}

export function StepRail({ steps, currentIndex, onSelect, onMove, renderStepMeta, conflictStepIds }: StepRailProps) {
  const handleDrop = (event: DragEvent<HTMLElement>, to: number) => {
    event.preventDefault()
    const from = Number(event.dataTransfer.getData('text/plain'))
    if (Number.isInteger(from)) onMove(from, to)
  }

  return (
    <div className="space-y-3" aria-label="拆装步骤轨道">
      {steps.map((step, index) => {
        const hasConflict = conflictStepIds?.has(step.id)
        return (
          <article
            key={step.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(index))
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => handleDrop(event, index)}
            className={`group rounded-xl border p-3 transition ${
              hasConflict
                ? 'border-amber-300 bg-amber-50/70 ring-1 ring-amber-200'
                : currentIndex === index
                  ? 'border-wood-500 bg-wood-50 shadow-sm'
                  : 'border-stone-200 bg-white hover:border-wood-100'
            }`}
            data-testid="step-row"
          >
            <button
              type="button"
              onClick={() => onSelect(index)}
              className="flex w-full items-start gap-3 text-left"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                currentIndex === index ? 'bg-wood-700 text-white' : 'bg-stone-100 text-stone-600'
              }`}>
                {step.seq}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-stone-900">{step.action}</strong>
                  <span className="text-xs text-stone-500">{step.direction} · {step.tool}</span>
                  {hasConflict ? (
                    <span className="rounded-full bg-amber-900 px-2 py-0.5 text-[10px] font-semibold text-amber-50" data-testid="step-conflict">
                      待核对
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs leading-5 text-stone-500">{step.riskNote}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-wood-700">
                  <span>停留 {step.holdSec} 秒</span>
                  {renderStepMeta ? renderStepMeta(step) : null}
                </span>
              </span>
            </button>
            <div className="mt-2 flex justify-end">
              <span className="cursor-grab select-none rounded px-2 py-1 text-[11px] text-stone-400 group-active:cursor-grabbing">
                拖动调序
              </span>
            </div>
          </article>
        )
      })}
    </div>
  )
}
