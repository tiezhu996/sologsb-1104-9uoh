import { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import AppRoutes from './router'
import { resolveEditor, setCustomLabel } from './utils/editor'
import { useSyncStore } from './utils/sync'

const navItems = [
  { to: '/joints', label: '榫卯图鉴' },
  { to: '/furniture', label: '家具反查' },
]

export default function App() {
  const editor = useSyncStore((state) => state.editor)
  const peers = useSyncStore((state) => state.peers)
  const pendingCount = useSyncStore((state) => state.pendingCount)
  const init = useSyncStore((state) => state.init)
  const refreshPeers = useSyncStore((state) => state.refreshPeers)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    void resolveEditor().then((resolved) => {
      if (cancelled) return
      init(resolved, window.location.pathname)
    })
    return () => {
      cancelled = true
    }
  }, [init])

  useEffect(() => {
    if (!editor) return
    const onRoute = () => refreshPeers(window.location.pathname)
    window.addEventListener('hashchange', onRoute)
    return () => window.removeEventListener('hashchange', onRoute)
  }, [editor, refreshPeers])

  const otherPeers = useMemo(() => peers.filter((peer) => !peer.self), [peers])

  const saveName = () => {
    setCustomLabel(nameDraft)
    setEditingName(false)
    if (editor) refreshPeers(window.location.pathname)
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-wood-100 bg-wood-50/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <NavLink to="/joints" className="group flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-wood-700 text-white shadow-sm">
              <svg aria-hidden="true" viewBox="0 0 48 48" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M7 15h12v-7h10v7h12v10H29v11H19V25H7z" />
                <path d="M19 15v10M29 15v10M19 25h10" />
              </svg>
            </span>
            <span>
              <strong className="block text-base tracking-wide text-wood-900">榫卯结构拆解图鉴</strong>
              <span className="block text-[11px] tracking-[0.2em] text-wood-500">GBMORTISE</span>
            </span>
          </NavLink>
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="主导航" className="flex items-center gap-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }: { isActive: boolean }) => `rounded-lg px-4 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-wood-700 text-white shadow-sm' : 'text-wood-700 hover:bg-white'
                  }`}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            {editor ? (
              <div className="flex items-center gap-2 rounded-lg border border-wood-200 bg-white px-2.5 py-1.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-wood-700 text-[11px] font-bold text-white">
                  {editor.label.slice(-1)}
                </span>
                {editingName ? (
                  <span className="flex items-center gap-1">
                    <input
                      autoFocus
                      className="w-24 rounded border border-wood-200 px-1.5 py-0.5 text-xs outline-none focus:border-wood-500"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') saveName()
                        if (event.key === 'Escape') setEditingName(false)
                      }}
                      placeholder={editor.label}
                      aria-label="本窗口名称"
                    />
                    <button type="button" className="text-[11px] text-wood-700" onClick={saveName}>确定</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-medium text-wood-800 hover:underline"
                    title="点击为本窗口命名，便于在修改来源中辨认"
                    onClick={() => { setNameDraft(''); setEditingName(true) }}
                    data-testid="editor-chip"
                  >
                    {editor.label}
                  </button>
                )}
                {otherPeers.length > 0 ? (
                  <span
                    className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200"
                    title={`同时编辑：${otherPeers.map((peer) => peer.label).join('、')}`}
                    data-testid="peers-badge"
                  >
                    同编辑 {otherPeers.length} 窗
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {pendingCount > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 sm:px-6 lg:px-8" data-testid="pending-banner">
          <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          有 {pendingCount} 处修改尚未写库，已保留在本机；将自动重试，重新打开也会继续恢复。
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <AppRoutes />
      </main>
      <footer className="mt-12 border-t border-wood-100 bg-white/70">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>榫卯取材于木，合于分寸。</span>
          <span>数据保存在当前浏览器 IndexedDB 中 · 多窗口按记录标识合并</span>
        </div>
      </footer>
    </div>
  )
}
