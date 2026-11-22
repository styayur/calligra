import { uiText } from "../../i18n"
import { guideUrl } from '../../i18n'
import { useState } from 'react'
import { CompanionControls } from '../editor/CompanionControls'
import { localWorkbench, type CompanionStatus } from '../../api/localWorkbench'
import { saveFile } from '../../lib/download'

interface Analysis {
  font_family: string
  paragraphs: { number: number; text: string; heading: boolean }[]
  selected_paragraphs: number[]
  required_characters: string[]
  missing_characters: string[]
  skipped_complex_paragraphs: number[]
  changed_segments: number
}

const limit = 40 * 1024 * 1024

export function DocumentTypesetting() {
  const [document, setDocument] = useState<File>()
  const [font, setFont] = useState<File>()
  const [headings, setHeadings] = useState(false)
  const [han, setHan] = useState(true)
  const [paragraphs, setParagraphs] = useState('')
  const [originalFont, setOriginalFont] = useState('')
  const [includePdf, setIncludePdf] = useState(false)
  const [report, setReport] = useState<Analysis>()
  const [companion, setCompanion] = useState<CompanionStatus>({ ready: false })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const kind = document?.name.split('.').at(-1)?.toLowerCase()


  const execute = async (analyze: boolean) => {
    if (!document || !font || !kind) return
    setBusy(true)
    setStatus('')
    setReport(undefined)
    try {
      if (!['docx', 'odt'].includes(kind) || !/\.(ttf|otf)$/i.test(font.name))
        throw new Error(uiText("请选择 DOCX 或 ODT 文档和 TTF 或 OTF 字体"))
      if (font.size > limit || document.size > limit) throw new Error(uiText("单个文件上限为 40 MiB"))
      const filters = new URLSearchParams({
        font_bytes: String(font.size), headings: String(headings), han_only: String(han), analyze: String(analyze), pdf: String(includePdf && !!companion.pdf),
      })
      const numbers = paragraphs.split(/[\s,，]+/).filter(Boolean)
      if (numbers.some((number) => !/^[1-9][0-9]{0,5}$/.test(number))) throw new Error(uiText("请用逗号分隔段落编号"))
      numbers.forEach((number) => filters.append('paragraphs', number))
      if (kind === 'docx' && originalFont.trim()) filters.set('original_font', originalFont.trim())
      const body = new Blob([font, document], { type: 'application/octet-stream' })
      const result = await localWorkbench('documents/' + kind + '?' + filters.toString(), body)
      if (analyze) setReport(await result.json() as Analysis)
      else {
        await saveFile('Calligra-' + kind + '.zip', await result.blob())
        setStatus(uiText("已下载处理后的文档和分析清单"))
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return <main className="materials-workspace studio-tool panel-scroll">
    <section>
      <h1>{uiText("文档排版")}</h1>
      <CompanionControls onStatus={setCompanion} />
      <fieldset disabled={!companion.ready || busy}>
        <label>{uiText("文档")}<input type="file" accept=".docx,.odt" onChange={(event) => { setDocument(event.target.files?.[0]); setReport(undefined) }} /></label>
        <label>{uiText("字体文件")}<input type="file" accept=".ttf,.otf" onChange={(event) => { setFont(event.target.files?.[0]); setReport(undefined) }} /></label>
        <label className="check-field"><input type="checkbox" checked={han} onChange={(event) => { setHan(event.target.checked); setReport(undefined) }} />{uiText("仅汉字")}</label>
        <label className="check-field"><input type="checkbox" checked={headings} onChange={(event) => { setHeadings(event.target.checked); setReport(undefined) }} />{uiText("仅标题")}</label>
        <label>{uiText("段落编号")}<input value={paragraphs} maxLength={1000} placeholder={uiText("留空处理所选范围内的所有段落")} onChange={(event) => { setParagraphs(event.target.value); setReport(undefined) }} /></label>
        {kind === 'docx' && <label>{uiText("原字体")}<input value={originalFont} maxLength={120} placeholder={uiText("仅匹配明确指定的字体")} onChange={(event) => { setOriginalFont(event.target.value); setReport(undefined) }} /></label>}
        <label className="check-field"><input type="checkbox" disabled={!companion.pdf} checked={includePdf} onChange={(event) => setIncludePdf(event.target.checked)} />{uiText("同时导出 PDF（需本机 LibreOffice）")}</label>
        <div className="scan-actions">
          <button type="button" disabled={!document || !font} onClick={() => void execute(true)}>{uiText("分析覆盖")}</button>
          <button type="button" disabled={!document || !font} onClick={() => void execute(false)}>{uiText("转换并下载")}</button>
        </div>
      </fieldset>
      <a href={guideUrl('#documents')}>{uiText("文档排版教程")}</a>
      <p role="status">{status}</p>
    </section>
    {report && <section aria-label={uiText("文档分析")}>
      <h1>{report.font_family}</h1>
      <p>{uiText("覆盖")} {report.required_characters.length - report.missing_characters.length}/{report.required_characters.length} {uiText("字 · 可替换")} {report.changed_segments} {uiText("段文字")}</p>
      {report.missing_characters.length > 0 && <p>{uiText("缺字")} {report.missing_characters.join('、')}</p>}
      {report.skipped_complex_paragraphs.length > 0 && <p>{uiText("保留含复杂对象的段落")} {report.skipped_complex_paragraphs.join('、')}</p>}
      <ol className="document-paragraphs">
        {report.paragraphs.slice(0, 500).map((paragraph) => <li key={paragraph.number}>
          <strong>{paragraph.number} {paragraph.heading ? uiText("标题") : ''}</strong> {paragraph.text}
        </li>)}
      </ol>
    </section>}
  </main>
}
