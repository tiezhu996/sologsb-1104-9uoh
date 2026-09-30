import { useCallback, useRef } from 'react'
import type { DimField } from '../types/edit'
import { useJointStore } from '../stores/jointStore'

interface DimensionEditApi {
  /** 字段获得焦点 / 开始录入时调用，冻结当时读到的基准值。 */
  beginEdit: (memberId: string, field: DimField) => void
  commit: (memberId: string, field: DimField, valueMm: number) => Promise<void>
}

/**
 * 尺寸录入与会话状态：
 * 基准值（开始编辑时的现值）在编辑期间冻结，提交时一并带给合并引擎，
 * 这样两个窗口同改一处时才能正确判断“谁基于哪个基准”。
 */
export function useDimensionEdit(): DimensionEditApi {
  const bases = useRef(new Map<string, number>())
  const commitDimension = useJointStore((state) => state.commitDimension)

  const beginEdit = useCallback((memberId: string, field: DimField) => {
    const member = useJointStore.getState().members.find((item) => item.id === memberId)
    if (!member) return
    bases.current.set(`${memberId}:${field}`, member[field])
  }, [])

  const commit = useCallback(async (memberId: string, field: DimField, valueMm: number) => {
    const key = `${memberId}:${field}`
    const member = useJointStore.getState().members.find((item) => item.id === memberId)
    if (!member) return
    const frozen = bases.current.get(key)
    const baseValue = frozen ?? member[field]
    bases.current.delete(key)
    if (valueMm === member[field] && frozen === undefined) return
    await commitDimension(memberId, { field, value: valueMm, baseValue })
  }, [commitDimension])

  return { beginEdit, commit }
}
