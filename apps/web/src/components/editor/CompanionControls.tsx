import { guideUrl, uiText } from "../../i18n"
import { useEffect, useState } from 'react'
import { companionStatus, disconnectCompanion, localWorkbenchAvailable, type CompanionStatus } from '../../api/localWorkbench'

export function CompanionControls({ onStatus }: { onStatus: (value: CompanionStatus) => void }) {
  const [status, setStatus] = useState<CompanionStatus>({ ready: false })
  const [code, setCode] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [failure, setFailure] = useState('')
  const available = localWorkbenchAvailable()

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
      const result = await companionStatus(code)
      setStatus(result)
      onStatus(result)
      if (result.ready) setCode('')
    } catch (error) {
      setStatus({ ready: false })
      onStatus({ ready: false })
      setFailure(error instanceof Error ? error.message : uiText("无法连接 Companion"))
    } finally {
      setConnecting(false)
    }
  }

  return <div className="companion-controls">
    <p className="field-hint">
      {status.ready ? uiText("Companion 已就绪，处理在本机进行。") : !available ? uiText("请在桌面浏览器使用 Companion。") :
          uiText("按教程启动 Companion，然后输入终端中显示的连接码。")}
    </p>
    {available && !status.ready && <div className="scan-actions">
      <label>{uiText("连接码")}<input type="password" spellCheck={false} autoComplete="off"
        value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <button type="button" disabled={connecting || !code.trim()} onClick={() => void connect()}>
        {connecting ? uiText("正在连接 Companion…") : uiText("连接 Companion")}
      </button>
      <a href={guideUrl('#companion')} target="_blank" rel="noreferrer">{uiText('安装和启动 Companion')}</a>
    </div>}
    {status.ready && <>
      <p className="field-hint">{uiText("字体编译与文档转换可用。PDF")} {status.pdf ? uiText("可用") : uiText("未配置")}{uiText("，实验 OCR")} {status.ocr ? uiText("可用") : uiText("未配置")}。</p>
      <button type="button" onClick={() => {
        disconnectCompanion()
        setStatus({ ready: false })
        onStatus({ ready: false })
      }}>{uiText("断开连接")}</button>
    </>}
    {failure && <p role="alert">{failure}</p>}
  </div>
}
