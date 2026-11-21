/** Explicit processing requests are confined to the local companion API. */
export const localWorkbenchAvailable = () =>
  window.location.protocol === 'app:' ||
  ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)

export async function localWorkbench(path: string, body: Blob, signal?: AbortSignal) {
  if (!localWorkbenchAvailable()) throw new Error('请在本机运行离线工作台和处理服务')
  const response = await fetch('http://127.0.0.1:8000/api/workbench/' + path, {
    method: 'POST',
    body,
    signal,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  }).catch((error) => {
    if (signal?.aborted) throw error
    throw new Error('无法连接本机处理服务，请按教程启用服务')
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : '本机处理失败')
  }
  return response
}
