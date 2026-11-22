import { useEffect, useState } from 'react'
import { companionStatus, disconnectCompanion, localWorkbenchAvailable, managedCompanion, type CompanionStatus } from '../../api/localWorkbench'

export function CompanionControls({ onStatus }: { onStatus: (value: CompanionStatus) => void }) {
  const [status, setStatus] = useState<CompanionStatus>({ ready: false })
  const [code, setCode] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [failure, setFailure] = useState('')
  const available = localWorkbenchAvailable()
  const managed = managedCompanion()

  useEffect(() => {
    let active = true
    if (available) void companionStatus().then((result) => {
      if (active) { setStatus(result); onStatus(result) }
    }).catch(() => undefined)
    return () => { active = false }
  }, [available, onStatus])

  const connect = async () => {
    setConnecting(true)
    setFailure('')
    try {
      const result = await companionStatus(managed, managed ? undefined : code)
      setStatus(result)
      onStatus(result)
      if (result.ready) setCode('')
    } catch (error) {
      setStatus({ ready: false })
      onStatus({ ready: false })
      setFailure(error instanceof Error ? error.message : '无法连接 Companion')
    } finally {
      setConnecting(false)
    }
  }

  return <div className="companion-controls">
    <p className="field-hint">
      {status.ready ? 'Companion 已就绪，处理在本机进行。' : !available ? '请在桌面浏览器使用 Companion。' :
        managed ? '处理需要本机 Companion 和 64 位 Python 3.12 或 3.13。首次启动会联网安装依赖。' :
          '按教程启动 Companion，然后输入终端中显示的连接码。'}
    </p>
    {available && !status.ready && <div className="scan-actions">
      {!managed && <label>连接码<input type="password" spellCheck={false} autoComplete="off"
        value={code} onChange={(event) => setCode(event.target.value)} /></label>}
      <button type="button" disabled={connecting || (!managed && !code.trim())} onClick={() => void connect()}>
        {connecting ? '正在连接 Companion…' : managed ? '启动 Companion' : '连接 Companion'}
      </button>
    </div>}
    {status.ready && !managed && <>
      <p className="field-hint">字体编译与文档转换可用。PDF {status.pdf ? '可用' : '未配置'}，实验 OCR {status.ocr ? '可用' : '未配置'}。</p>
      <button type="button" onClick={() => {
        disconnectCompanion()
        setStatus({ ready: false })
        onStatus({ ready: false })
      }}>断开连接</button>
    </>}
    {failure && <p role="alert">{failure}</p>}
  </div>
}
