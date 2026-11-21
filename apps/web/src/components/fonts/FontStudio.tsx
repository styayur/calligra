import { useEffect, useState } from 'react'
import { localWorkbench, localWorkbenchAvailable } from '../../api/localWorkbench'
import { saveFile } from '../../lib/download'
import { textCharacters } from '../../lib/identity'
import { packedGlyphs, privateGlyphs } from '../../lib/privateLibrary'
import type { Glyph } from '../../types'

const userPermission = '用户确认可改作及再分发'
const accepted = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', userPermission])

function eligible(glyph: Glyph) {
  const { asset, source, provenance, character } = glyph
  return provenance.type === 'original' && !!source.license && accepted.has(source.license) &&
    source.rights?.font_export_allowed !== false && source.rights?.derivatives_allowed === true && source.rights?.redistribution_allowed === true &&
    asset.url.startsWith('data:image/png;base64,') && !!asset.checksum &&
    /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(character)
}

export function FontStudio({ projectGlyphs }: { projectGlyphs: Glyph[] }) {
  const [library, setLibrary] = useState<Glyph[]>([])
  const [source, setSource] = useState<'library' | 'project'>('library')
  const [text, setText] = useState('')
  const [family, setFamily] = useState('Calligra Collection')
  const [filters, setFilters] = useState({ work: '', author: '', style: '' })
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [formats, setFormats] = useState(['ttf', 'otf', 'woff2'])
  const [approved, setApproved] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void Promise.all([privateGlyphs(), packedGlyphs()]).then((groups) => setLibrary(groups.flat())).catch(() => setStatus('无法读取个人字库'))
  }, [])

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
      if (payload.size > 32 * 1024 * 1024) throw new Error('字体制作文件上限为 32 MiB，请缩小字集')
      if (compile) {
        const result = await localWorkbench('fonts', payload)
        await saveFile(family + '.zip', await result.blob())
        setStatus('已生成字体和授权清单')
      } else {
        await saveFile('calligra-font-request.json', payload)
        setStatus('已保存字体制作文件')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return <main className="materials-workspace studio-tool panel-scroll">
    <section>
      <h1>字体制作</h1>
      <fieldset disabled={busy}>
        <label>字形来源<select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
          <option value="library">本机字库</option><option value="project">当前作品</option>
        </select></label>
        <label>字体名称<input value={family} maxLength={48} onChange={(event) => setFamily(event.target.value)} /></label>
        <label>目标文字<textarea value={text} maxLength={4096} onChange={(event) => setText(event.target.value)} placeholder="留空使用筛选出的全部字形" /></label>
        <details className="advanced">
          <summary>筛选字形</summary>
          {([['work', '作品'], ['author', '书家'], ['style', '书体']] as const).map(([key, label]) =>
            <label key={key}>{label}<input value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} /></label>)}
        </details>
        <div className="scan-actions">
          {['ttf', 'otf', 'woff2'].map((format) => <label key={format} className="check-field">
            <input type="checkbox" checked={formats.includes(format)} onChange={(event) =>
              setFormats(event.target.checked ? [...formats, format] : formats.filter((current) => current !== format))} />{format.toUpperCase()}
          </label>)}
        </div>
        {usePrivate && <label className="check-field"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />确认私人来源允许生成和分发字体</label>}
        <div className="scan-actions">
          {localWorkbenchAvailable() && <button type="button" disabled={!ready} onClick={() => void exportFont(true)}>生成并下载字体</button>}
          <button type="button" disabled={!ready} onClick={() => void exportFont(false)}>保存字体制作文件</button>
        </div>
      </fieldset>
      <a href={import.meta.env.BASE_URL + 'guide/index.html#fonts'}>字体制作教程</a>
      <p role="status">{status}</p>
    </section>
    <section aria-label="字体覆盖">
      <h1>覆盖与预览</h1>
      <p>{selected.length} 个原始来源字形 · 0 个补字</p>
      <p>{target.length ? '目标覆盖 ' + (target.length - missing.length) + '/' + target.length : selected.length + ' 个可用字形'}</p>
      {missing.length > 0 && <p>缺字 {missing.join('、')}</p>}
      {glyphs.some((glyph) => !eligible(glyph)) && <details className="advanced">
        <summary>未通过授权或格式检查的字形</summary>
        <ul>{glyphs.filter((glyph) => !eligible(glyph)).slice(0, 100).map((glyph) =>
          <li key={glyph.id}>{glyph.character} · {glyph.source.license || '授权未标注'} · {glyph.source.work || glyph.source.dataset}</li>)}</ul>
      </details>}
      <div className="font-glyphs">
        {selected.slice(0, 512).map((glyph) => <div key={glyph.character}>
          <img src={glyph.asset.url} alt={glyph.character} />
          <label>{glyph.character}
            <select value={glyph.id} onChange={(event) => setChosen({ ...chosen, [glyph.character]: event.target.value })}>
              {byCharacter.get(glyph.character)?.map((variant, index) => <option key={variant.id} value={variant.id}>{index + 1} · {variant.source.work || variant.source.dataset}</option>)}
            </select>
          </label>
          {Math.max(glyph.asset.width, glyph.asset.height) < 56 && <small>低分辨率</small>}
        </div>)}
      </div>
    </section>
  </main>
}
