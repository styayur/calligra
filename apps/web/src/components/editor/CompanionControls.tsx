import { useEffect, useState } from 'react'
import { companionStatus, localWorkbenchAvailable, managedCompanion, type CompanionStatus } from '../../api/localWorkbench'

export function CompanionControls({ onStatus }: { onStatus: (value: CompanionStatus) => void }) {
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState('')
  const available = localWorkbenchAvailable()
  const managed = managedCompanion()

  useEffect(() => {
    let active = true
    if (available) void companionStatus().then((status) => {
      if (active) { setReady(status.ready); onStatus(status) }
    }).catch(() => undefined)
    return () => { active = false }
  }, [available, onStatus])

  const connect = async () => {
    setStarting(true)
    setFailure('')
    try {
      const status = await companionStatus(managed)
      setReady(status.ready)
      onStatus(status)
    } catch (error) {
      setReady(false)
      onStatus({ ready: false })
      setFailure(error instanceof Error ? error.message : '无法启动 Companion')
    } finally {
      setStarting(false)
    }
  }

  return <div className="companion-controls">
    <p className="field-hint">
      {ready ? 'Companion 已就绪，处理在本机进行。' : !available ? '此平台不运行 Companion。请在 Windows 或本机浏览器完成处理。' :
        managed ? '处理需要本机 Companion 和 64 位 Python 3.12 或 3.13。首次启动会联网安装依赖。' :
          '处理需要先按教程启动本机 Companion。'}
    </p>
    {available && !ready && <div className="scan-actions">
      <button type="button" disabled={starting} onClick={() => void connect()}>
        {starting ? '正在准备 Companion…' : managed ? '启动 Companion' : '检查 Companion 连接'}
      </button>
    </div>}
    {failure && <p role="alert">{failure}</p>}
  </div>
}
