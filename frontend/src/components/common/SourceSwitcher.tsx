import { useEffect, useState } from 'react'
import { formatSourceLabel, getSourceId, resetSourceId } from '../../utils/source'

/**
 * 显示当前窗口（来源）标识，并可一键切换到“另一个窗口”。
 * 用于演示两个窗口同时编辑同一种榫卯：先在窗口 A 修改，
 * 再切换到窗口 B 修改同一条记录，即会触发待核对项。
 */
export function SourceSwitcher() {
  const [source, setSource] = useState<string>('')

  useEffect(() => {
    setSource(getSourceId())
  }, [])

  const switchWindow = () => {
    setSource(resetSourceId())
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-wood-100 bg-white px-2.5 py-1.5 text-xs text-stone-600">
      <span className="flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
      <span className="hidden sm:inline">当前来源</span>
      <span className="font-medium text-wood-700">{source ? formatSourceLabel(source) : '读取中…'}</span>
      <button
        type="button"
        className="rounded-md border border-wood-100 px-2 py-0.5 text-wood-700 transition hover:border-wood-500 hover:bg-wood-50"
        onClick={switchWindow}
        title="切换到另一个窗口继续编辑"
      >
        切换窗口
      </button>
    </div>
  )
}
