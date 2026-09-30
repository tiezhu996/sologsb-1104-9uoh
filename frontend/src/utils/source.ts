const SOURCE_KEY = 'gbmortise-source-id'

/**
 * 每个窗口（标签页）持有一个来源标识，用于标记修改来自哪一边。
 * 存放在 sessionStorage：同一浏览器的不同窗口各自独立，
 * 正好对应“两个窗口同时编辑同一种榫卯”的场景。
 */
export function getSourceId(): string {
  let id = sessionStorage.getItem(SOURCE_KEY)
  if (!id) {
    id = `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    sessionStorage.setItem(SOURCE_KEY, id)
  }
  return id
}

/**
 * 重新生成来源标识，模拟“换到另一个窗口”继续编辑。
 * 返回新的来源标识。
 */
export function resetSourceId(): string {
  const id = `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  sessionStorage.setItem(SOURCE_KEY, id)
  return id
}

/** 把来源标识渲染成简短可辨的标签，例如 src-a1b2c3 -> 窗口 a1b2c3。 */
export function formatSourceLabel(source: string): string {
  const short = source.replace(/^src-/, '').slice(-6)
  return `窗口 ${short}`
}
