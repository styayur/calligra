import { uiText } from "../../i18n"
import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const supported = import.meta.env.PROD && import.meta.env.MODE !== 'android' && import.meta.env.VITE_STATIC_MODE === 'true' && !Capacitor.isNativePlatform() &&
  ['http:', 'https:'].includes(location.protocol) && window.isSecureContext && 'serviceWorker' in navigator

function askOffline(worker: ServiceWorker, type: 'offline-status' | 'offline-prepare'): Promise<boolean> {
  const channel = new MessageChannel()
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      window.clearTimeout(timeout)
      channel.port1.close()
      resolve(ready)
    }
    const timeout = window.setTimeout(() => finish(false), 180_000)
    channel.port1.onmessage = (event) => finish(event.data?.ready === true)
    worker.postMessage({ type }, [channel.port2])
  })
}

export function OfflineControls() {
  const [worker, setWorker] = useState<ServiceWorker | null>(null)
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [state, setState] = useState<'initial' | 'ready' | 'preparing' | 'failed'>('initial')
  const [updateWaiting, setUpdateWaiting] = useState(false)
  useEffect(() => {
    if (!supported) return
    let mounted = true
    const install = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPrompt)
    }
    const installed = () => setPrompt(null)
    const controllerChanged = () => {
      const active = navigator.serviceWorker.controller
      setWorker(active)
      if (active) void askOffline(active, 'offline-status').then((ready) => {
        if (mounted) setState((current) => current === 'preparing' ? current : ready ? 'ready' : 'initial')
      })
    }
    window.addEventListener('beforeinstallprompt', install)
    window.addEventListener('appinstalled', installed)
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
    controllerChanged()
    let releaseRegistration: undefined | (() => void)
    void navigator.serviceWorker.register(new URL('service-worker.js', document.baseURI), { updateViaCache: 'none' })
      .then((registration) => {
        if (!mounted) return
        const check = () => setUpdateWaiting(Boolean(registration.waiting && navigator.serviceWorker.controller))
        let incoming: ServiceWorker | null = null
        const onUpdate = () => {
          incoming?.removeEventListener('statechange', check)
          incoming = registration.installing
          incoming?.addEventListener('statechange', check)
        }
        registration.addEventListener('updatefound', onUpdate)
        onUpdate()
        check()
        releaseRegistration = () => {
          registration.removeEventListener('updatefound', onUpdate)
          incoming?.removeEventListener('statechange', check)
        }
      }).catch(() => { if (mounted) setState('failed') })
    return () => {
      mounted = false
      window.removeEventListener('beforeinstallprompt', install)
      window.removeEventListener('appinstalled', installed)
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged)
      releaseRegistration?.()
    }
  }, [])
  if (!supported) return null

  async function prepare() {
    if (!worker) return
    setState('preparing')
    void navigator.storage?.persist?.().catch(() => false)
    setState(await askOffline(worker, 'offline-prepare') ? 'ready' : 'failed')
  }

  return <div className="mode-secondary" role="group" aria-label={uiText("离线工作台")}>
    {prompt && <button onClick={() => {
      setPrompt(null)
      void prompt.prompt().catch(() => undefined)
    }}>{uiText("安装 Calligra")}</button>}
    <button disabled={!worker || state === 'preparing' || state === 'ready'} onClick={() => void prepare()}>
      {state === 'preparing' ? uiText("正在下载离线字体…") : state === 'ready' ? uiText("离线字体已就绪") : uiText("下载离线字体")}
    </button>
    {state === 'failed' && <span role="status">{uiText("离线准备失败，请检查网络或本机存储后重试。")}</span>}
    {updateWaiting && <span role="status">{uiText("更新已下载。请保存作品并关闭所有 Calligra 窗口后重新打开。")}</span>}
  </div>
}
