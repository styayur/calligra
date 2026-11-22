import { uiText } from "../../i18n"
import { guideUrl } from '../../i18n'
import { useEffect, useState } from 'react'
import { unzipSync } from 'fflate'
import { CompanionControls } from '../editor/CompanionControls'
import { localWorkbench, type CompanionStatus } from '../../api/localWorkbench'
import { saveFile } from '../../lib/download'
import { textCharacters, variationPairs } from '../../lib/identity'
import { packedGlyphs, privateGlyphs } from '../../lib/privateLibrary'
import type { Glyph } from '../../types'
import { useEditorStore } from '../../stores/editor'

const userPermission = '用户确认可改作及再分发'
const accepted = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', userPermission])

function eligible(glyph: Glyph) {
  const { asset, source, provenance, character } = glyph
  return provenance.type === 'original' && !!source.license && accepted.has(source.license) &&
    source.rights?.font_export_allowed !== false && source.rights?.derivatives_allowed === true && source.rights?.redistribution_allowed === true &&
    asset.url.startsWith('data:image/png;base64,') && !!asset.checksum &&
    (/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(character) ||
      ([...character].length === 2 && Boolean(variationPairs(character)?.length)))
}

export function FontStudio({ projectGlyphs, fromProject, onDocument }: {
  projectGlyphs: Glyph[]
  fromProject: boolean
  onDocument: (font: File) => void
}) {
  const draft = useEditorStore.getState()
  const [library, setLibrary] = useState<Glyph[]>([])
  const [source, setSource] = useState<'library' | 'project'>(fromProject ? 'project' : 'library')
  const [text, setText] = useState(fromProject ? draft.project.text ?? '' : '')
  const [family, setFamily] = useState(() => {
    const name = draft.projectName.replace(/[^A-Za-z0-9 -]/g, '').trim()
    return fromProject && name ? ('Calligra ' + name).slice(0, 48).trimEnd() : 'Calligra Collection'
  })
  const [filters, setFilters] = useState({ work: '', author: '', style: '' })
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [formats, setFormats] = useState(['ttf'])
  const [recommend, setRecommend] = useState(fromProject)
  const [compiled, setCompiled] = useState<File>()
  const [preview, setPreview] = useState<FontFace>()
  const [approved, setApproved] = useState(false)
  const [companion, setCompanion] = useState<CompanionStatus>({ ready: false })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void Promise.all([privateGlyphs(), packedGlyphs()]).then((groups) => setLibrary(groups.flat())).catch(() => setStatus(uiText("无法读取个人字库")))
  }, [])
  useEffect(() => () => { if (preview) document.fonts.delete(preview) }, [preview])

  const matches = (actual: string | null | undefined, filter: string) => !filter.trim() || actual?.includes(filter.trim())
  const target = [...new Set(textCharacters(text).filter((character) => character.trim()))]
  const glyphs = (source === 'library' ? library : projectGlyphs).filter((glyph) =>
    (!target.length || target.includes(glyph.character)) && matches(glyph.source.work, filters.work) &&
    matches(glyph.source.calligrapher || glyph.source.designer, filters.author) &&
    matches(glyph.source.style, filters.style),
  )
  const byCharacter = new Map<string, Glyph[]>()
  for (const glyph of glyphs.filter(eligible)) {
    const variants = byCharacter.get(glyph.character) ?? []
    variants.push(glyph)
    byCharacter.set(glyph.character, variants)
  }
  const recommended = recommend && source === 'project' ? library.filter((glyph) =>
    target.includes(glyph.character) && !byCharacter.has(glyph.character) && eligible(glyph) &&
    projectGlyphs.some((item) => item.source.writing_tradition && item.source.writing_tradition === glyph.source.writing_tradition)) : []
  for (const glyph of recommended) {
    if (!byCharacter.has(glyph.character)) byCharacter.set(glyph.character, [glyph])
  }
  const selected = [...byCharacter].map(([character, glyphs]) =>
    glyphs.find((glyph) => glyph.id === chosen[character]) || glyphs[0])
  const missing = target.filter((character) => !byCharacter.has(character))
  const usePrivate = selected.some((glyph) => glyph.source.license === userPermission)
  const ready = selected.length > 0 && selected.length <= 512 && !!formats.length &&
    /^[A-Za-z][A-Za-z0-9 -]{1,47}$/.test(family) && (!usePrivate || approved)

  const exportFont = async (compile: boolean) => {
    setBusy(true)
    setStatus('')
    try {
      const payload = new Blob([JSON.stringify({
        family, text, formats, glyphs: selected, confirm_private_rights: approved,
      })], { type: 'application/json' })
      if (payload.size > 32 * 1024 * 1024) throw new Error(uiText("字体制作文件上限为 32 MiB，请缩小字集"))
      if (compile) {
        const result = await localWorkbench('fonts', payload)
        const archive = await result.blob()
        const files = unzipSync(new Uint8Array(await archive.arrayBuffer()))
        const fontName = Object.keys(files).find((name) => name.endsWith('.ttf')) ||
          Object.keys(files).find((name) => name.endsWith('.otf') || name.endsWith('.woff2'))
        if (!fontName) throw new Error(uiText('字体文件未生成'))
        const bytes = new Uint8Array(files[fontName])
        const face = await new FontFace('Calligra Studio Preview', bytes.buffer).load()
        document.fonts.add(face)
        setPreview(face)
        setCompiled(/\.(ttf|otf)$/i.test(fontName) ? new File([bytes], fontName) : undefined)
        await saveFile(family + '.zip', archive)
        setStatus(uiText("已生成字体和授权清单"))
      } else {
        await saveFile('calligra-font-request.json', payload)
        setStatus(uiText("已保存字体制作文件"))
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return <main className="materials-workspace studio-tool panel-scroll">
    <section>
      <h1>{uiText("字体制作")}</h1>
      <CompanionControls onStatus={setCompanion} />
      <fieldset disabled={busy}>
        <label>{uiText("字形来源")}<select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
          <option value="library">{uiText("本机字库")}</option><option value="project">{uiText("当前作品")}</option>
        </select></label>
        <label>{uiText("字体名称")}<input value={family} maxLength={48} onChange={(event) => setFamily(event.target.value)} /></label>
        <label>{uiText("目标文字")}<textarea value={text} maxLength={4096} onChange={(event) => setText(event.target.value)} placeholder={uiText("留空使用筛选出的全部字形")} /></label>
        <details className="advanced">
          <summary>{uiText("筛选字形与高级格式")}</summary>
          {([['work', uiText("作品")], ['author', uiText("书家")], ['style', uiText("书体")]] as const).map(([key, label]) =>
            <label key={key}>{label}<input value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} /></label>)}
          <div className="scan-actions">
          {['ttf', 'otf', 'woff2'].map((format) => <label key={format} className="check-field">
            <input type="checkbox" checked={formats.includes(format)} onChange={(event) =>
              setFormats(event.target.checked ? [...formats, format] : formats.filter((current) => current !== format))} />{format.toUpperCase()}
          </label>)}
          </div>
        </details>
        {source === 'project' && <label className="check-field"><input type="checkbox" checked={recommend}
          onChange={(event) => setRecommend(event.target.checked)} />{uiText('推荐同传统的合规字库补字')}</label>}
        {usePrivate && <label className="check-field"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />{uiText("确认私人来源允许生成和分发字体")}</label>}
        <div className="scan-actions">
          <button type="button" disabled={!ready || !companion.ready} onClick={() => void exportFont(true)}>{uiText("生成并下载字体")}</button>
          <button type="button" disabled={!ready} onClick={() => void exportFont(false)}>{uiText("保存字体制作文件")}</button>
        </div>
      </fieldset>
      <a href={guideUrl('#fonts')}>{uiText("字体制作教程")}</a>
      <p role="status">{status}</p>
      {compiled && <button type="button" onClick={() => onDocument(compiled)}>{uiText('在文档中使用此字体')}</button>}
    </section>
    <section aria-label={uiText("字体覆盖")}>
      <h1>{uiText("覆盖与预览")}</h1>
      <p>{selected.length} {uiText('个可用字形')} · {uiText('推荐补字 {{count}} 个', { count: recommended.length })}</p>
      {preview && <p aria-label={uiText('已生成字体预览')}
        style={{ fontFamily: '"Calligra Studio Preview"', fontSize: '2rem', overflowWrap: 'anywhere' }}>
        {selected.map((glyph) => glyph.character).join(' ')}
      </p>}
      <p>{target.length ? uiText("目标覆盖 ") + (target.length - missing.length) + '/' + target.length : selected.length + uiText(" 个可用字形")}</p>
      {missing.length > 0 && <p>{uiText("缺字")} {missing.join('、')}</p>}
      {glyphs.some((glyph) => !eligible(glyph)) && <details className="advanced">
        <summary>{uiText("未通过授权或格式检查的字形")}</summary>
        <ul>{glyphs.filter((glyph) => !eligible(glyph)).slice(0, 100).map((glyph) =>
          <li key={glyph.id}>{glyph.character} · {glyph.source.license || uiText("授权未标注")} · {glyph.source.work || glyph.source.dataset}</li>)}</ul>
      </details>}
      <div className="font-glyphs">
        {selected.slice(0, 512).map((glyph) => <div key={glyph.character}>
          <img src={glyph.asset.url} alt={glyph.character} />
          <label>{glyph.character}
            <select value={glyph.id} onChange={(event) => setChosen({ ...chosen, [glyph.character]: event.target.value })}>
              {byCharacter.get(glyph.character)?.map((variant, index) => <option key={variant.id} value={variant.id}>{index + 1} · {variant.source.work || variant.source.dataset}</option>)}
            </select>
          </label>
          {Math.max(glyph.asset.width, glyph.asset.height) < 56 && <small>{uiText("低分辨率")}</small>}
        </div>)}
      </div>
    </section>
  </main>
}
