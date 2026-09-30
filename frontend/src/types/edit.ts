/**
 * 多窗口并发编辑的操作记录、来源与待核对项模型。
 *
 * 设计要点：
 * - 每次尺寸修改或步序移动都是一条不可变的“编辑记录”（EditRecord），
 *   带编辑窗口来源与基准位置；
 * - 合并以构件 / 步骤的记录标识（memberId / stepId）为键；
 * - 同一字段 / 同一步骤被两个窗口基于不同基准改过时，不互相覆盖，
 *   而是生成一条 status='open' 的待核对项，保留双方来源。
 */

export type DimField = 'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm'

export const DIM_FIELDS: DimField[] = ['lengthMm', 'widthMm', 'thicknessMm', 'toleranceMm']

export const DIM_FIELD_LABELS: Record<DimField, string> = {
  lengthMm: '长度',
  widthMm: '宽度',
  thicknessMm: '厚度',
  toleranceMm: '配合公差',
}

/** 编辑窗口来源，标签在编辑发生时快照留存，事后改名不影响旧记录。 */
export interface EditorRef {
  editorId: string
  editorLabel: string
}

export interface DimEditPayload {
  kind: 'dim'
  memberId: string
  jointTypeId: string
  field: DimField
  value: number
  /** 该窗口开始编辑时读到的基准值，用于三路合并判断。 */
  baseValue: number
  /** 待核对项裁决时标记来源，普通编辑为空。 */
  resolvedFrom?: string
}

export interface MoveEditPayload {
  kind: 'move'
  stepId: string
  jointTypeId: string
  /** 拖动前所在序号（1 起）。 */
  fromSeq: number
  /** 期望落到的序号（1 起）。 */
  toSeq: number
  /** 拖动前该步骤的 orderKey，移动冲突的判定基准。 */
  baseOrderKey: number
  /** 目标位置的前后锚点步骤标识，即便其它步骤也在移动也能复原意图。 */
  beforeId: string | null
  afterId: string | null
  resolvedFrom?: string
}

export type EditPayload = DimEditPayload | MoveEditPayload

export interface EditRecord {
  /** 编辑记录标识，同时用于幂等去重。 */
  id: string
  editorId: string
  editorLabel: string
  /** 发生时间（毫秒时间戳）。 */
  at: number
  /** 真正写入主表的时间；写库失败滞留 outbox 时为空。 */
  appliedAt?: number
  payload: EditPayload
}

export interface FieldProvenance {
  editorId: string
  editorLabel: string
  at: number
  /** 该来源所依据的基准值。 */
  baseValue: number
  /** 写入后的记录版本。 */
  revision: number
  /** 该修改是否仍滞留本地、尚未写库。 */
  pending?: boolean
  /** 由待核对项裁决产生。 */
  resolvedFrom?: string
}

export interface StepProvenance {
  editorId: string
  editorLabel: string
  at: number
  /** 移动前的基准序号。 */
  baseSeq: number
  /** 移动后的序号。 */
  newSeq: number
  pending?: boolean
  resolvedFrom?: string
}

export interface DimProposal extends EditorRef {
  editId: string
  at: number
  value: number
  baseValue: number
}

export interface MoveProposal extends EditorRef {
  editId: string
  at: number
  fromSeq: number
  toSeq: number
  beforeId: string | null
  afterId: string | null
}

interface ReviewBase {
  id: string
  status: 'open' | 'resolved'
  jointTypeId: string
  /** 被争用的记录标识：构件或步骤 id。 */
  recordId: string
  createdAt: number
  updatedAt: number
  resolvedAt?: number
  /** 裁决采用了哪个窗口的方案。 */
  chosenEditorId?: string
}

export interface DimReviewItem extends ReviewBase {
  kind: 'dim'
  field: DimField
  /** 当前已落库的一方。 */
  applied: DimProposal
  /** 后来、与当前值冲突的各方提议；同一窗口再次提交会覆盖其旧提议。 */
  proposals: DimProposal[]
}

export interface MoveReviewItem extends ReviewBase {
  kind: 'move'
  /** 冲突发生时已经落位的一方。 */
  applied: MoveProposal
  proposals: MoveProposal[]
}

export type ReviewItem = DimReviewItem | MoveReviewItem

export function createEditId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `edit-${Date.now().toString(36)}-${random}`
}

export function createReviewId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `review-${Date.now().toString(36)}-${random}`
}
