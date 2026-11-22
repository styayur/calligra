import { useEffect, useState } from 'react'
import { guideUrl, uiText } from '../../i18n'
import { CompanionControls } from '../editor/CompanionControls'
import { localWorkbench, type CompanionStatus } from '../../api/localWorkbench'
import { fontCatalog, type FontEntry } from '../../api/fonts'
import { bundledFontBytes } from '../../lib/fontShaper'
import { saveFile } from '../../lib/download'
import { zipFiles } from '../../lib/longRoll'

interface Analysis {
  font_family: string
  paragraphs: { number: number; text: string; heading: boolean }[]
  selected_paragraphs: number[]
  required_characters: string[]
  missing_characters: string[]
  skipped_complex_paragraphs: number[]
  changed_segments: number
}

async function localFont(entry: FontEntry) {
  const raw = await bundledFontBytes({ ...entry, ...entry.opentype })
  const extension = new TextDecoder().decode(raw.slice(0, 4)) === 'OTTO' ? '.otf' : '.ttf'
  return new File([raw], entry.id + extension)
}

export function DocumentTypesetting({ createdFont }: { createdFont?: File }) {
  const [input, setInput] = useState<File>()
  const [uploaded, setUploaded] = useState<File>()
  const [fonts, setFonts] = useState<FontEntry[]>([])
  const [style, setStyle] = useState(createdFont ? 'generated' : 'ma-shan-zheng')
  const [scope, setScope] = useState('all')
  const [han, setHan] = useState(false)
  const [paragraphs, setParagraphs] = useState('')
  const [originalFont, setOriginalFont] = useState('')
  const [includePdf, setIncludePdf] = useState(false)
  const [report, setReport] = useState<Analysis>()
  const [preview, setPreview] = useState<FontFace>()
  const [companion, setCompanion] = useState<CompanionStatus>({ ready: false })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const kind = input?.name.split('.').at(-1)?.toLowerCase()
  const selectedFont = fonts.find((item) => item.id === style)

  useEffect(() => {
    void fontCatalog().then((rows) => setFonts(rows.filter((font) => font.source_role !== 'coverage-fallback' &&
      font.rights.font_license === true && font.orthography !== 'historical-kana')))
      .catch((error) => setStatus(String(error)))
  }, [])
  useEffect(() => () => { if (preview) document.fonts.delete(preview) }, [preview])

  async function execute(analyze: boolean) {
    if (!input || !kind) return
    setBusy(true)
    setStatus('')
    if (analyze) setReport(undefined)
    try {
      let font = style === 'generated' ? createdFont : uploaded
      if (style !== 'generated' && style !== 'uploaded') {
        if (!selectedFont) throw new Error(uiText('请选择文档字体'))
        font = await localFont(selectedFont)
      }
      if (!font || !['docx', 'odt'].includes(kind) || !/\.(ttf|otf)$/i.test(font.name))
        throw new Error(uiText("请选择 DOCX 或 ODT 文档和 TTF 或 OTF 字体"))
      if (input.size > 40 * 1024 * 1024 || font.size > 40 * 1024 * 1024) throw new Error(uiText("单个文件上限为 40 MiB"))
      const filters = new URLSearchParams({
        font_bytes: String(font.size), headings: String(scope === 'headings'), body_only: String(scope === 'body'),
        han_only: String(han), analyze: String(analyze), pdf: String(includePdf && Boolean(companion.pdf)),
      })
      const numbers = paragraphs.split(/[\s,，]+/).filter(Boolean)
      if (numbers.some((number) => !/^[1-9][0-9]{0,5}$/.test(number))) throw new Error(uiText("请用逗号分隔段落编号"))
      numbers.forEach((number) => filters.append('paragraphs', number))
      if (kind === 'docx' && originalFont.trim()) filters.set('original_font', originalFont.trim())
      const result = await localWorkbench('documents/' + kind + '?' + filters, new Blob([font, input], { type: 'application/octet-stream' }))
      if (analyze) {
        const analysis = await result.json() as Analysis
        const face = await new FontFace('Calligra Document Preview', await font.arrayBuffer()).load()
        document.fonts.add(face)
        setPreview(face)
        setReport(analysis)
      } else {
        await saveFile('Calligra-' + kind + '.zip', await result.blob())
        setStatus(uiText("已下载处理后的文档和分析清单"))
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const downloadBundled = async (entry: FontEntry) => {
    if (!entry.license_text || !/^fonts\/licenses\/OFL-[a-z-]+\.txt$/.test(entry.license_text)) return
    setBusy(true)
    try {
      const font = await localFont(entry)
      const license = await fetch(import.meta.env.BASE_URL + entry.license_text, { redirect: 'error' })
      if (!license.ok) throw new Error(uiText('字体许可证无法读取'))
      await saveFile(entry.id + '.zip', zipFiles([
        { name: font.name, data: new Uint8Array(await font.arrayBuffer()) },
        { name: entry.license_text.split('/').at(-1)!, data: new Uint8Array(await license.arrayBuffer()) },
      ]))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const ready = companion.ready && companion.documents && (scope !== 'body' || companion.document_body_scope) &&
    input && (style !== 'uploaded' || uploaded)
  return <main className="materials-workspace studio-tool panel-scroll">
    <section>
      <h1>{uiText("文档排版")}</h1>
      <fieldset disabled={busy}>
        <label>{uiText("文档")}<input type="file" accept=".docx,.odt" onChange={(event) => { setInput(event.target.files?.[0]); setReport(undefined) }} /></label>
        <label>{uiText('书法字体')}
          <select aria-label={uiText('书法字体')} value={style} onChange={(event) => { setStyle(event.target.value); setReport(undefined) }}>
            {fonts.map((font) => <option key={font.id} value={font.id}>{font.family}</option>)}
            {createdFont && <option value="generated">{createdFont.name}</option>}
            <option value="uploaded">{uiText('使用本地字体文件')}</option>
          </select>
        </label>
        {style === 'uploaded' && <label>{uiText("字体文件")}
          <input type="file" accept=".ttf,.otf" onChange={(event) => { setUploaded(event.target.files?.[0]); setReport(undefined) }} />
        </label>}
        <details className="advanced">
          <summary>{uiText('文档替换范围与高级选项')}</summary>
          <label>{uiText('替换范围')}<select value={scope} onChange={(event) => { setScope(event.target.value); setReport(undefined) }}>
            <option value="all">{uiText('标题与正文')}</option>
            <option value="headings">{uiText('仅标题')}</option>
            <option value="body" disabled={!companion.document_body_scope}>{uiText('仅正文')}</option>
          </select></label>
          {companion.ready && !companion.document_body_scope && <p className="field-hint">
            {uiText('仅正文替换需要 v0.11.0 的 Companion。')}
          </p>}
          <label className="check-field"><input type="checkbox" checked={han} onChange={(event) => { setHan(event.target.checked); setReport(undefined) }} />{uiText("仅汉字")}</label>
          <label>{uiText("段落编号")}<input value={paragraphs} maxLength={1000} placeholder={uiText("留空处理所选范围内的所有段落")} onChange={(event) => { setParagraphs(event.target.value); setReport(undefined) }} /></label>
          {kind === 'docx' && <label>{uiText("原字体")}<input value={originalFont} maxLength={120} placeholder={uiText("仅匹配明确指定的字体")} onChange={(event) => { setOriginalFont(event.target.value); setReport(undefined) }} /></label>}
          <label className="check-field"><input type="checkbox" disabled={!companion.pdf} checked={includePdf} onChange={(event) => { setIncludePdf(event.target.checked); setReport(undefined) }} />{uiText("同时导出 PDF（需本机 LibreOffice）")}</label>
          {companion.pdf && <p className="field-hint">{uiText('使用 LibreOffice 导出前，请先在系统安装所选字体。')}</p>}
        </details>
        <div className="scan-actions">
          <button type="button" disabled={!ready} onClick={() => void execute(true)}>{uiText("分析覆盖")}</button>
          <button type="button" disabled={!ready || !report} onClick={() => void execute(false)}>{uiText("转换并下载")}</button>
        </div>
      </fieldset>
      <CompanionControls onStatus={setCompanion} />
      <a href={guideUrl('#documents')}>{uiText("文档排版教程")}</a>
      <p role="status">{status}</p>
    </section>
    {report && <section aria-label={uiText("文档分析")}>
      <h2>{report.font_family}</h2>
      <p>{uiText("覆盖")} {report.required_characters.length - report.missing_characters.length}/{report.required_characters.length} {uiText("字 · 可替换")} {report.changed_segments} {uiText("段文字")}</p>
      {report.missing_characters.length > 0 && <p>{uiText("缺字")} {report.missing_characters.join('、')}</p>}
      {report.skipped_complex_paragraphs.length > 0 && <p>{uiText("保留含复杂对象的段落")} {report.skipped_complex_paragraphs.join('、')}</p>}
      <p>{uiText('下方预览显示字形效果。分页由打开文档的程序重新计算。')}</p>
      <p>{uiText('在办公软件中查看替换效果前，请先安装所选字体。')}</p>
      {selectedFont?.license_text && <button disabled={busy} type="button"
        onClick={() => void downloadBundled(selectedFont)}>{uiText('下载字体与许可证')}</button>}
      <ol className="document-paragraphs">
        {report.paragraphs.slice(0, 500).map((paragraph) => <li key={paragraph.number}>
          <strong>{paragraph.number} {paragraph.heading ? uiText("标题") : ''}</strong>{' '}
          <span style={{ fontFamily: report.selected_paragraphs.includes(paragraph.number) ? '"Calligra Document Preview"' : undefined }}>
            {paragraph.text}
          </span>
        </li>)}
      </ol>
    </section>}
  </main>
}
