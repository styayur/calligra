import { Capacitor } from '@capacitor/core'

export const managedCompanion = () => window.location.protocol === 'app:' && window.location.hostname === 'bundle'

export const localWorkbenchAvailable = () => managedCompanion() ||
  (!Capacitor.isNativePlatform() && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname))

export interface CompanionStatus {
  ready: boolean
  pdf?: boolean
  ocr?: boolean
}

export async function companionStatus(start = false): Promise<CompanionStatus> {
  if (!localWorkbenchAvailable()) return { ready: false }
  if (start && managedCompanion()) await workbenchRequest('start', { method: 'POST' })
  return (await workbenchRequest('status', { method: 'GET', signal: AbortSignal.timeout(2500) })).json()
}

async function workbenchRequest(path: string, init: RequestInit) {
  if (!localWorkbenchAvailable()) throw new Error('请在 Windows 工作台或本机浏览器运行 Companion')
  const base = managedCompanion() ? 'app://bundle/_companion/' : 'http://127.0.0.1:8000/api/workbench/'
  const response = await fetch(base + path, {
    ...init, credentials: 'omit', redirect: 'error', cache: 'no-store',
  }).catch((error) => {
    if (init.signal?.aborted && init.method !== 'GET') throw error
    throw new Error('无法连接本机 Companion。请按教程启动服务并重新检查连接。')
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : '本机处理失败')
  }
  return response
}

export function localWorkbench(path: string, body: Blob, signal?: AbortSignal) {
  return workbenchRequest(path, { method: 'POST', body, signal })
}
