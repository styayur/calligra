import { Capacitor, registerPlugin } from '@capacitor/core'
import { useEffect, useState } from 'react'

type CheckedRelease = { available: false } | {
  available: true
  version: string
  versionCode: number
  size: number
  notes: string
  source: string
}
const updates = registerPlugin<{
  checkUpdate(): Promise<CheckedRelease>
  downloadUpdate(): Promise<{ verified: boolean }>
  openInstaller(): Promise<{ permissions: boolean }>
}>('OfficialUpdates')
const AUTO_KEY = 'calligra.android.update-reminders'
const LAST_CHECK = 'calligra.android.last-update-check'
const DAY = 24 * 60 * 60 * 1000
const android = Capacitor.getPlatform() === 'android'

export function AndroidUpdates() {
  if (!android) return null
  return <UpdateControls />
}

function UpdateControls() {
  const [reminders, setReminders] = useState(() => localStorage.getItem(AUTO_KEY) === 'yes')
  const [offer, setOffer] = useState<Extract<CheckedRelease, { available: true }> | null>(null)
  const [verified, setVerified] = useState(false)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  async function check(automatic: boolean) {
    setBusy(true)
    setStatus('')
    setOffer(null)
    setVerified(false)
    localStorage.setItem(LAST_CHECK, String(Date.now()))
    try {
      const result = await updates.checkUpdate()
      if (result.available) {
        setOffer(result)
        setVisible(true)
      } else if (!automatic) setStatus('当前已是最新正式版本。')
    } catch {
      if (!automatic) setStatus('无法检查正式更新，请稍后重试。')
    } finally { setBusy(false) }
  }
  useEffect(() => {
    if (reminders && Date.now() - Number(localStorage.getItem(LAST_CHECK) || '0') >= DAY) {
      void check(true)
    }
  }, [reminders])

  async function download() {
    setBusy(true)
    setStatus('正在下载并校验官方 APK…')
    try {
      if (!(await updates.downloadUpdate()).verified) throw new Error('APK verification failed')
      setVerified(true)
      setStatus('下载已校验。请继续通过 Android 确认安装。')
    } catch { setStatus('下载或 APK 校验失败，请重试。') }
    finally { setBusy(false) }
  }

  async function install() {
    setBusy(true)
    try {
      const result = await updates.openInstaller()
      setStatus(result.permissions
        ? '请在 Android 设置中允许此来源安装，返回后再次点击安装。'
        : '请在 Android 安装界面确认升级。')
    } catch { setStatus('无法启动 Android 安装程序，请重试。') }
    finally { setBusy(false) }
  }

  return <div className="mode-secondary">
    <button type="button" aria-expanded={visible} onClick={() => setVisible((shown) => !shown)}>应用更新</button>
    {visible && <section className="android-updates" aria-label="应用更新">
      <button type="button" disabled={busy} onClick={() => void check(false)}>检查正式更新</button>
      <label className="check-field"><input type="checkbox" checked={reminders} disabled={busy}
        onChange={(event) => {
          const enabled = event.target.checked
          localStorage.setItem(AUTO_KEY, enabled ? 'yes' : 'no')
          setReminders(enabled)
        }} />启动时自动提醒</label>
      {offer && <>
        <p><strong>Calligra {offer.version}</strong> · {(offer.size / 1024 / 1024).toFixed(1)} MiB</p>
        <p className="field-hint">来源 · <a href={offer.source} target="_blank" rel="noreferrer">GitHub Releases</a></p>
        {offer.notes && <details><summary>发行说明</summary><p className="release-notes">{offer.notes}</p></details>}
        {verified
          ? <button type="button" disabled={busy} onClick={() => void install()}>通过 Android 安装</button>
          : <button type="button" disabled={busy} onClick={() => void download()}>下载并校验 APK</button>}
      </>}
      {status && <p role="status">{status}</p>}
    </section>}
  </div>
}
