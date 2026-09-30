import type { StepProvenance } from './edit'

export type StepAction = '拆卸' | '装配'
export type StepDirection = '轴向' | '侧向' | '斜向'
export type StepTool = '木槌' | '鱼线' | '撬板'

export interface DisassemblyStep {
  id: string
  jointTypeId: string
  seq: number
  action: StepAction
  direction: StepDirection
  tool: StepTool
  riskNote: string
  holdSec: number
  /** 排序基准键：同类型步骤等距布键，移动时取相邻中点，支持不同步骤各自移动。 */
  orderKey?: number
  /** 记录版本，每接受一次移动递增。 */
  revision?: number
  /** 最近一次移动的来源与基准序号。 */
  lastMove?: StepProvenance
  schemaRev?: number
}
