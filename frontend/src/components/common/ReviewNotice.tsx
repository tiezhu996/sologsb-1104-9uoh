import { DIM_FIELD_LABELS } from '../../types/edit'
import type { ReviewItem } from '../../types/edit'
import { useSyncStore } from '../../utils/sync'
import { formatDimension } from '../../utils/measure'

interface ReviewNoticeProps {
  reviews: ReviewItem[]
  /** 构件 id → 构件名；步骤用 id 即可，标题处会另行传名称映射。 */
  memberNames?: Record<string, string>
}

/**
 * 待核对面板：同一尺寸 / 同一步骤被两个窗口基于不同基准改过时出现。
 * 不自动覆盖任何一方，列出双方来源与方案，木作师傅点选其一裁决。
 */
export function ReviewNotice({ reviews, memberNames }: ReviewNoticeProps) {
  const resolve = useSyncStore((state) => state.resolve)

  if (reviews.length === 0) return null

  return (
    <section className="space-y-3" data-testid="review-panel">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold text-amber-900">待核对修改</h2>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
          {reviews.length} 项
        </span>
      </div>
      <p className="text-sm text-stone-500">
        两个窗口改到了同一处且基准不同，已保留双方来源，未互相覆盖。请核对后选定最终方案。
      </p>
      <div className="space-y-4">
        {reviews.map((review) => (
          <article key={review.id} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5" data-testid="review-item">
            <header className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-900 px-2.5 py-1 text-[11px] font-semibold text-amber-50">
                {review.kind === 'dim' ? '尺寸冲突' : '步序冲突'}
              </span>
              <h3 className="text-sm font-semibold text-amber-950">
                {review.kind === 'dim'
                  ? `${memberNames?.[review.recordId] ?? '构件'} · ${DIM_FIELD_LABELS[review.field]}`
                  : `步骤「${memberNames?.[review.recordId] ?? review.recordId}」移动位置不一致`}
              </h3>
            </header>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ProposalCard
                tag="当前已采用"
                editorLabel={review.applied.editorLabel}
                editorId={review.applied.editorId}
                active={false}
                description={describeApplied(review)}
                meta={`来源：${review.applied.editorLabel}`}
                onChoose={() => void resolve(review.id, review.applied.editId)}
              />
              {review.proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.editId}
                  tag="另一窗口提议"
                  editorLabel={proposal.editorLabel}
                  editorId={proposal.editorId}
                  active={false}
                  description={describeProposal(review, proposal)}
                  meta={`来源：${proposal.editorLabel}`}
                  onChoose={() => void resolve(review.id, proposal.editId)}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function describeApplied(review: ReviewItem): string {
  if (review.kind === 'dim') {
    return `现值 ${formatDimension(review.applied.value)}（其基准 ${formatDimension(review.applied.baseValue)}）`
  }
  return `已落在第 ${review.applied.toSeq} 位（原第 ${review.applied.fromSeq} 位）`
}

function describeProposal(review: ReviewItem, proposal: ReviewItem['applied']): string {
  if (review.kind === 'dim' && 'value' in proposal) {
    return `改为 ${formatDimension(proposal.value)}（其基准 ${formatDimension(proposal.baseValue)}）`
  }
  if (review.kind === 'move' && 'fromSeq' in proposal) {
    return `由第 ${proposal.fromSeq} 位移到第 ${proposal.toSeq} 位`
  }
  return ''
}

interface ProposalCardProps {
  tag: string
  editorLabel: string
  editorId: string
  description: string
  meta: string
  active: boolean
  onChoose: () => void
}

function ProposalCard({ tag, editorLabel, description, meta, onChoose }: ProposalCardProps) {
  void editorLabel
  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-amber-700">{tag}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-stone-800">{description}</p>
      <p className="mt-1 text-[11px] text-stone-500">{meta}</p>
      <button
        type="button"
        className="mt-3 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
        onClick={onChoose}
        data-testid="resolve-choice"
      >
        采用此方案
      </button>
    </div>
  )
}
