import { uiText } from "../i18n"
import { Capacitor } from '@capacitor/core'

const KEY = 'calligra.companion.connection'
const PROTOCOL = 1
const CONNECTION = /^([0-9]{1,5}):([0-9a-f]{64})$/

export const localWorkbenchAvailable = () => !Capacitor.isNativePlatform() &&
  window.isSecureContext && ['https:', 'http:'].includes(window.location.protocol)

export interface CompanionStatus {
  ready: boolean
  protocol?: number
  fonts?: boolean
  documents?: boolean
  document_body_scope?: boolean
  pdf?: boolean
  ocr?: boolean
  ocr_models?: string[]
}

function connection(code: string) {
  const match = CONNECTION.exec(code.trim())
  if (!match || +match[1] < 1 || +match[1] > 65535) throw new Error(uiText("请输入 Companion 显示的完整连接码。"))
  return { base: 'http://127.0.0.1:' + match[1] + '/api/workbench/', token: match[2] }
}

let sessionCode: string | undefined
try { sessionCode = sessionStorage.getItem(KEY) || undefined } catch { /* storage may be disabled */ }

export function disconnectCompanion() {
  sessionCode = undefined
  try { sessionStorage.removeItem(KEY) } catch { /* storage may be disabled */ }
}

export async function companionStatus(code?: string): Promise<CompanionStatus> {
  if (!localWorkbenchAvailable() || (!sessionCode && !code)) return { ready: false }
  const result = await (await workbenchRequest('status', { method: 'GET', signal: AbortSignal.timeout(3500) }, code)).json()
  if (result.protocol !== PROTOCOL || !result.ready) throw new Error(uiText("Companion 版本不兼容，请启动此版本附带的服务。"))
  if (code) {
    sessionCode = code.trim()
    try { sessionStorage.setItem(KEY, sessionCode) } catch { /* use in-memory connection */ }
  }
  return result
}

async function workbenchRequest(path: string, init: RequestInit, code = sessionCode) {
  if (!localWorkbenchAvailable()) throw new Error(uiText("请在桌面浏览器连接本机 Companion。"))
  if (!code) throw new Error(uiText("请先在本机启动 Companion 并输入连接码。"))
  const endpoint = connection(code)
  const response = await fetch(endpoint.base + path, {
    ...init, headers: { Authorization: 'Bearer ' + endpoint.token },
    credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
  }).catch((error) => {
    if (init.signal?.aborted && init.method !== 'GET') throw error
    throw new Error(uiText("无法连接本机 Companion。请检查服务、授权来源和浏览器的本地网络权限。"))
  })
  if (!response.ok) {
    if (response.status === 403) throw new Error(uiText("Companion 拒绝了连接，请核对连接码并检查授权来源。"))
    const payload = await response.json().catch(() => null)
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : uiText("本机处理失败"))
  }
  return response
}

export function localWorkbench(path: string, body: Blob, signal?: AbortSignal) {
  return workbenchRequest(path, { method: 'POST', body, signal })
}
