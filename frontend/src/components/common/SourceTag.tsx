import type { FieldProvenance, StepProvenance } from '../../types/edit'
import { formatDimension } from '../../utils/measure'

/** 尺寸字段的来源小徽标：窗口名 + 基准值；待写库时脉冲提示。 */
export function FieldSourceTag({ source }: { source: FieldProvenance }) {
  const title = `${source.editorLabel} 修改（基准 ${formatDimension(source.baseValue)}）${
    source.resolvedFrom === 'review' ? '，经待核对裁决' : ''
  }`
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-4 ${
        source.pending ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'bg-stone-100 text-stone-500'
      }`}
      title={title}
      data-testid="field-source"
    >
      {source.pending && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />}
      {source.editorLabel} · 基准 {formatDimension(source.baseValue)}
    </span>
  )
}

/** 步骤最近一次移动的来源：从第几位到第几位。 */
export function StepSourceTag({ source }: { source: StepProvenance }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-4 ${
        source.pending ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'bg-wood-50 text-wood-700'
      }`}
      title={`${source.editorLabel} 移动：第 ${source.baseSeq} 位 → 第 ${source.newSeq} 位${
        source.resolvedFrom === 'review' ? '（经待核对裁决）' : ''
      }`}
      data-testid="step-source"
    >
      {source.pending && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />}
      {source.editorLabel} · {source.baseSeq} → {source.newSeq}
    </span>
  )
}
