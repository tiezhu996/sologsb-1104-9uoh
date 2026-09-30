import type { FieldProvenance } from './edit'

export type MemberName = '榫头' | '榫眼' | '大边' | '抹头'
export type MemberPart = '出榫件' | '受榫件'
export type GrainDirection = '顺纹' | '横纹'

export interface Member {
  id: string
  jointTypeId: string
  name: MemberName
  part: MemberPart
  grainDir: GrainDirection
  lengthMm: number
  widthMm: number
  thicknessMm: number
  toleranceMm: number
  note: string
  /** 记录版本，每接受一次修改递增，是三方合并的基础水位。 */
  revision?: number
  /** 各尺寸字段最近一次写入的来源与基准值。 */
  dimSources?: Partial<Record<'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm', FieldProvenance>>
  schemaRev?: number
}
