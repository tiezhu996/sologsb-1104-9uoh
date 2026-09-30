export type RecordType = 'member' | 'step'

export type ChangeStatus = 'pending' | 'applied' | 'conflict'

/**
 * 一次带来源与基准的修改。
 * - source：发起这次修改的窗口（来源标识）
 * - baseValue：修改所依据的基准值（基准位置）
 * - newValue：修改后的新值
 */
export interface ChangeRecord {
  id: string
  recordType: RecordType
  recordId: string
  jointTypeId: string
  field: string
  baseValue: number | string
  newValue: number | string
  source: string
  status: ChangeStatus
  createdAt: number
}

export interface ConflictOption {
  source: string
  value: number | string
}

/**
 * 待核对项：同一条记录的同一字段被两个来源改出不同值时保留，
 * 不覆盖任何一方，等待人工选择。
 */
export interface ConflictItem {
  id: string
  recordType: RecordType
  recordId: string
  jointTypeId: string
  field: string
  baseValue: number | string
  options: ConflictOption[]
  status: 'open' | 'resolved'
  resolution?: number | string
  createdAt: number
}
