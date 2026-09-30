export type StepAction = '拆卸' | '装配'
export type StepDirection = '轴向' | '侧向' | '斜向'
export type StepTool = '木槌' | '鱼线' | '撬板'

export interface DisassemblyStep {
  id: string
  jointTypeId: string
  seq: number
  /**
   * 合并用的顺序键：拖动某一步只改这一步的 orderKey，
   * 不同步骤各自移动不会互相覆盖；seq 由 orderKey 派生用于展示。
   */
  orderKey?: number
  action: StepAction
  direction: StepDirection
  tool: StepTool
  riskNote: string
  holdSec: number
  schemaRev?: number
}
