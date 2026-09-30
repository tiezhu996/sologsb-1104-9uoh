/**
 * 编辑窗口身份。
 *
 * 每个浏览器标签页拥有一个随会话存活的 editorId（sessionStorage），
 * 关闭窗口即失效；默认标签按“当前同榫卯编辑窗口数”命名为 窗口甲/乙/丙…。
 *
 * 复制标签页会连 sessionStorage 一起复制，导致两个窗口同号。
 * 初始化时通过一次短暂的 BroadcastChannel 握手发现撞号，
 * 撞号的一方重新生成身份。
 */

export interface Editor {
  id: string
  label: string
}

const ID_KEY = 'gbmortise-editor-id'
const LABEL_KEY = 'gbmortise-editor-label'

const ORDINALS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']

function randomId(): string {
  return `win-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readSessionId(): string | null {
  try {
    return sessionStorage.getItem(ID_KEY)
  } catch {
    return null
  }
}

function writeSession(id: string): void {
  try {
    sessionStorage.setItem(ID_KEY, id)
  } catch {
    /* 隐私模式等场景下落空时每次用新身份也可工作 */
  }
}

export function defaultLabel(ordinal: number): string {
  return `窗口${ORDINALS[ordinal] ?? ordinal + 1}`
}

export function getCustomLabel(): string | null {
  try {
    return localStorage.getItem(LABEL_KEY)
  } catch {
    return null
  }
}

export function setCustomLabel(label: string): void {
  const trimmed = label.trim()
  try {
    if (trimmed) localStorage.setItem(LABEL_KEY, trimmed)
    else localStorage.removeItem(LABEL_KEY)
  } catch {
    /* 忽略不可写场景 */
  }
}

interface ClashMessage {
  type: 'gbmortise-editor-clash'
  id: string
  nonce: number
}

interface ClashReply {
  type: 'gbmortise-editor-clash-reply'
  id: string
  nonce: number
}

/**
 * 确定当前窗口身份。先解决复制标签页带来的撞号，再落 sessionStorage。
 * 没有 BroadcastChannel 的环境（旧浏览器 / 测试）直接使用会话内 id。
 */
export async function resolveEditor(): Promise<Editor> {
  let id = readSessionId()

  if (id && typeof BroadcastChannel !== 'undefined') {
    const claimed = await claimUniqueId(id)
    if (!claimed) {
      id = randomId()
      const retried = await claimUniqueId(id)
      if (!retried) id = randomId()
    }
  }

  if (!id) id = randomId()
  writeSession(id)
  return { id, label: getCustomLabel() ?? defaultLabel(0) }
}

function claimUniqueId(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new BroadcastChannel('gbmortise-editor-presence')
    const nonce = Math.random()
    let answered = false
    const timer = window.setTimeout(finish, 220)

    function finish(): void {
      window.clearTimeout(timer)
      channel.close()
      resolve(!answered)
    }

    channel.onmessage = (event: MessageEvent<unknown>) => {
      const reply = event.data as ClashReply
      if (reply?.type === 'gbmortise-editor-clash-reply' && reply.nonce === nonce) {
        answered = reply.id === id
      }
    }

    channel.postMessage({ type: 'gbmortise-editor-clash', id, nonce } satisfies ClashMessage)

    // 另一个持同号的窗口回应；任何持同号者应答即视为撞号。
    const probe = (event: MessageEvent<unknown>) => {
      const message = event.data as ClashMessage
      if (message?.type === 'gbmortise-editor-clash' && message.nonce !== nonce && message.id === id) {
        channel.postMessage({ type: 'gbmortise-editor-clash-reply', id, nonce: message.nonce } satisfies ClashReply)
      }
    }
    channel.addEventListener('message', probe as EventListener)
  })
}
