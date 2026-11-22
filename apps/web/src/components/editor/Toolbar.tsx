import { uiText } from "../../i18n"
import { guideUrl } from '../../i18n'
import { Download, FolderOpen, MoreHorizontal, Redo2, Undo2 } from 'lucide-react'
import { ChangeEvent, useRef, useState } from 'react'
import { exportStagePng } from '../../canvas/stageExport'
import { useEditorStore } from '../../stores/editor'
import { validateProject } from '../../lib/project'
import { saveFile } from '../../lib/download'
import { Button } from '../ui'
import { assertExportRights, attributionFiles, hasShareAlike } from '../../lib/rights'
import { zipFiles } from '../../lib/longRoll'
import { APP_VERSION } from '../../lib/version'

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [transparent, setTransparent] = useState(false)
  const [scale, setScale] = useState(2)
  const [commercialOnly, setCommercialOnly] = useState(false)
  const [licensesOpen, setLicensesOpen] = useState(false)
  const {
    projectName,
    project,
    past,
    future,
    localStatus,
    setProjectName,
    newProject,
    undo,
    redo,
    loadProject,
  } = useEditorStore()
  const exportJson = async () => {
    const blob = new Blob([JSON.stringify({ name: projectName, ...project }, null, 2)], {
      type: 'application/json',
    })
    try {
      const result = await saveFile(`${projectName || uiText("集字作品")}.json`, blob)
      setStatus(
        result === 'shared' ? uiText("项目已交给系统保存或分享") : uiText("项目已下载，可用于备份或继续编辑"),
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : uiText("导出未完成，请重试"))
    }
  }
  const exportPng = async () => {
    try {
      assertExportRights(project.glyphs, { commercialOnly })
      const response = await fetch(exportStagePng({ scale, transparent }))
      const artwork = await response.blob()
      const files = await attributionFiles(project.glyphs, { commercialOnly })
      // Share-alike material travels as one package so obligations cannot be lost.
      const packaged = hasShareAlike(project.glyphs)
      const result = packaged
        ? await saveFile(`${projectName || uiText("集字作品")}.zip`, zipFiles([{ name:'artwork.png', data:new Uint8Array(await artwork.arrayBuffer()) }, ...files]))
        : await saveFile(`${projectName || uiText("集字作品")}.png`, artwork)
      if (!packaged) await saveFile(`${projectName || uiText("集字作品")}-attribution.zip`, zipFiles(files))
      setStatus(result === 'shared' ? uiText("作品已交给系统保存或分享") : uiText("作品已导出"))
      setExportOpen(false)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : uiText("导出失败，请重试"))
    }
  }
  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error(uiText("项目文件超过 40 MB，请选择较小的项目"))
      const value = JSON.parse(await file.text())
      const parsed = validateProject(value)
      if (
        project.glyphs.length &&
        !window.confirm(uiText("载入将替换当前作品。建议先下载项目备份，是否继续？"))
      )
        return
      loadProject(
        typeof value.name === 'string' ? value.name : file.name.replace(/\.json$/i, ''),
        parsed,
      )
      setStatus(uiText("项目已载入"))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : uiText("项目载入失败"))
    } finally {
      event.target.value = ''
    }
  }
  return (
    <header className="studio-header">
      <div className="brand-mark" aria-label="Calligra">
        <svg viewBox="0 0 96 96" role="img" aria-hidden="true">
          <rect width="96" height="96" rx="20" fill="#0f172a" />
          <rect x="3.5" y="3.5" width="89" height="89" rx="17.5" fill="none" stroke="#d946ef" strokeWidth="3" />
          <path
            d="M48 14 C28 26 22 42 28 58 C31 66 38 72 48 76 C62 72 68 64 70 52 C56 50 47 48 45 41 C62 35 70 25 74 16 Z"
            fill="none"
            stroke="#d946ef"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <circle cx="48" cy="55" r="5" fill="#d946ef" />
        </svg>
      </div>
      <span className="brand-name" aria-hidden="true">Calligra</span>
      <div className="project-heading">
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label={uiText("项目名称")}
        />
        <span role="status">{uiText(localStatus)}</span>
      </div>
      <div className="history-actions">
        <Button
          variant="ghost"
          size="icon"
          title={uiText("撤销 Ctrl+Z")}
          aria-label={uiText("撤销")}
          disabled={!past.length}
          onClick={undo}
        >
          <Undo2 size={17} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={uiText("重做 Ctrl+Shift+Z")}
          aria-label={uiText("重做")}
          disabled={!future.length}
          onClick={redo}
        >
          <Redo2 size={17} />
        </Button>
      </div>
      <div className="header-spacer" />
      <span className="toolbar-status" role="status">
        {status}
      </span>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={loadFile}
      />
      <details className="project-menu">
        <summary aria-label={uiText("项目菜单")}>
          <MoreHorizontal size={19} />
          <span>{uiText("项目")}</span>
        </summary>
        <div className="menu-popover">
          <button onClick={exportJson}>{uiText("下载项目文件")}</button>
          <button onClick={() => fileRef.current?.click()}>{uiText("载入项目文件")}</button>
          <button disabled={!past.length} onClick={undo}>
            {uiText("撤销上一步")}
          </button>
          <button disabled={!future.length} onClick={redo}>
            {uiText("重做上一步")}
          </button>
          <button
            onClick={() => {
              if (
                !project.glyphs.length ||
                window.confirm(uiText("新建会清空当前草稿，请先下载需要保留的作品。是否继续？"))
              ) {
                newProject()
                setStatus(uiText("已新建作品"))
              }
            }}
          >
            {uiText("新建空白作品")}
          </button>
          <a href={guideUrl()}>{uiText("教程")}</a>
          <p>Calligra · <span data-testid="app-version">{APP_VERSION}</span></p>
          <button onClick={() => setLicensesOpen(true)}>{uiText("第三方许可 / Third-party licences")}</button>
        </div>
      </details>
      {licensesOpen && <div role="dialog" aria-label="Third-party licences" style={{position:'fixed',inset:'5vh 5vw',zIndex:100,background:'#fff',border:'1px solid #cad4cc',boxShadow:'0 8px 40px #0003',display:'flex',flexDirection:'column'}}>
        <button onClick={() => setLicensesOpen(false)} aria-label={uiText("关闭第三方许可")} style={{padding:12,alignSelf:'flex-end'}}>{uiText("关闭 / Close")}</button>
        <iframe title={uiText("Bundled third-party licence texts")} src={`${import.meta.env.BASE_URL}third-party-licenses.html`} style={{border:0,flex:1,width:'100%'}} />
      </div>}
      <Button variant="secondary" className="save-project-button" onClick={exportJson}>
        <FolderOpen size={15} />
        {uiText("保存项目")}
      </Button>
      <div className="export-wrapper">
        <Button
          onClick={() => setExportOpen(!exportOpen)}
          disabled={!project.glyphs.length}
          aria-expanded={exportOpen}
        >
          <Download size={15} />
          {uiText("导出作品")}
        </Button>
        {exportOpen && (
          <div className="export-popover" role="dialog" aria-label={uiText("导出作品设置")}>
            <div className="section-title">
              <h3>{uiText("导出 PNG")}</h3>
              <button aria-label={uiText("关闭导出设置")} onClick={() => setExportOpen(false)}>
                ×
              </button>
            </div>
            <label>
              {uiText("导出尺寸")}
              <select
                aria-label={uiText("导出尺寸")}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              >
                <option value={1}>
                  {uiText("原尺寸 ·")} {project.canvas.width} × {project.canvas.height}
                </option>
                <option value={2}>
                  {uiText("2 倍 ·")} {project.canvas.width * 2} × {project.canvas.height * 2}
                </option>
              </select>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
              />
              {uiText("透明背景")}
            </label>
            <p className="field-hint">{uiText("导出不包含选框。图片字形的清晰度受原图分辨率限制。")}</p>
            <label className="check-field"><input type="checkbox" checked={commercialOnly} onChange={(e) => setCommercialOnly(e.target.checked)} />{uiText("商用导出 / Commercial-only export")}</label>
            <p className="field-hint">{uiText("附机器可读与文字来源清单；含 CC BY-SA 字形时，PNG 与授权清单一起打包为 ZIP。")}</p>
            <Button className="w-full" onClick={exportPng}>
              {uiText("下载 PNG")}
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
