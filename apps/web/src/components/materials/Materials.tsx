import { useEffect, useState, type FormEvent } from 'react'
import { cropGlyph, locateCrops, openScan, type Crop, type InkOptions } from '../../lib/extraction'
import { sha256 } from '../../lib/fontShaper'
import { migrateGlyph, textCharacters, unicodeScript } from '../../lib/identity'
import { parseGlyphPack, type GlyphPack } from '../../lib/glyphPacks'
import { deletePrivateGlyph, enableGlyphPack, installGlyphPack, installedPacks, originalScan, privateGlyphs, PRIVATE_DATASET, removeGlyphPack, savePrivateGlyphs } from '../../lib/privateLibrary'
import { saveFile } from '../../lib/download'
import { CompanionControls } from '../editor/CompanionControls'
import { localWorkbench, type CompanionStatus } from '../../api/localWorkbench'
import type { Glyph } from '../../types'

interface Recognition {
  suggestion: string | null
  confidence: number
  engine: string
  language: string
  model_sha256: string
}

interface Candidate extends Crop {
  id: number
  character: string
  recognition?: Recognition
}

function Preview({ scan, box, options }: {
  scan: Awaited<ReturnType<typeof openScan>>
  box: Crop
  options: InkOptions
}) {
  const [images, setImages] = useState<{ original: string; result: string }>()
  const [error, setError] = useState('')
  useEffect(() => {
    try {
      const original = cropGlyph(scan.context, box, { ...options, mode: 'original' })
      const result = cropGlyph(scan.context, box, options)
      setImages({ original: original.toDataURL(), result: result.toDataURL() })
      setError('')
    } catch (error) {
      setImages(undefined)
      setError(String((error as Error).message))
    }
  }, [scan, box, options])
  if (!images) return <p role="status">{error}</p>
  return <div className="scan-comparison">
    <figure><img src={images.original} alt="原图切片" /><figcaption>原图</figcaption></figure>
    <figure><img src={images.result} alt="处理预览" /><figcaption>处理结果</figcaption></figure>
  </div>
}

function newCandidate(box: Crop, id: number): Candidate {
  return { ...box, id, character: '' }
}

export function Materials({ addGlyph }: { addGlyph: (glyph: Glyph) => void }) {
  const [glyphs, setGlyphs] = useState<Glyph[]>([])
  const [packs, setPacks] = useState<GlyphPack[]>([])
  const [packApproved, setPackApproved] = useState(false)
  const [file, setFile] = useState<File>()
  const [scan, setScan] = useState<Awaited<ReturnType<typeof openScan>>>()
  const [pagePreview, setPagePreview] = useState('')
  const [crops, setCrops] = useState<Candidate[]>([])
  const [active, setActive] = useState<number>()
  const [nextId, setNextId] = useState(1)
  const [vertical, setVertical] = useState(true)
  const [traditionalChinese, setTraditionalChinese] = useState(true)
  const [tradition, setTradition] = useState('Chinese')
  const [work, setWork] = useState('')
  const [page, setPage] = useState('')
  const [edition, setEdition] = useState('')
  const [calligrapher, setCalligrapher] = useState('')
  const [style, setStyle] = useState('')
  const [period, setPeriod] = useState('')
  const [permission, setPermission] = useState(false)
  const [restoration, setRestoration] = useState(false)
  const [options, setOptions] = useState<InkOptions>({ mode: 'clean', padding: 8, threshold: 12, polarity: 'auto' })
  const [companion, setCompanion] = useState<CompanionStatus>({ ready: false })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  const refresh = async () => {
    const [library, packs] = await Promise.all([privateGlyphs(), installedPacks()])
    setGlyphs(library)
    setPacks(packs)
  }
  useEffect(() => {
    void refresh().catch(() => setStatus('无法读取个人字库'))
  }, [])
  const current = crops.find((crop) => crop.id === active)
  const matches = (glyph: Glyph) => [glyph.character, glyph.source.work, glyph.source.calligrapher,
    glyph.source.style, glyph.source.period, glyph.source.dataset].some((value) => value?.includes(query.trim()))
  const available = glyphs.filter(matches)

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setStatus('')
    try {
      await operation()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const read = (image: File) => run(async () => {
    const decoded = await openScan(image)
    const box = { x: 0, y: 0, width: decoded.canvas.width, height: decoded.canvas.height }
    const preview = document.createElement('canvas')
    const ratio = Math.min(1, 1200 / Math.max(box.width, box.height))
    preview.width = Math.max(1, Math.round(box.width * ratio))
    preview.height = Math.max(1, Math.round(box.height * ratio))
    preview.getContext('2d')!.drawImage(decoded.canvas, 0, 0, preview.width, preview.height)
    setFile(image)
    setScan(decoded)
    setPagePreview(preview.toDataURL())
    setCrops([newCandidate(box, 0)])
    setActive(0)
    setNextId(1)
    setPermission(false)
    setRestoration(false)
  })

  const locate = () => {
    if (!scan) return
    void run(async () => {
      const found = locateCrops(scan.context.getImageData(0, 0, scan.canvas.width, scan.canvas.height), options, vertical)
      if (!found.length) throw new Error('未找到候选切框，请调整阈值或手动切框')
      setCrops(found.map((box, id) => newCandidate(box, id)))
      setActive(0)
      setNextId(found.length)
    })
  }

  const recognize = () => {
    if (!scan) return
    const unreviewed = crops.filter((crop) => !crop.character.trim())
    if (!unreviewed.length) return
    void run(async () => {
      const images = unreviewed.map(({ x, y, width, height }) => {
        const glyph = cropGlyph(scan.context, { x, y, width, height }, { ...options, mode: 'clean', padding: 0 })
        const canvas = document.createElement('canvas')
        const scale = Math.min(4, 340 / Math.max(glyph.width, glyph.height))
        canvas.width = Math.round(glyph.width * scale) + 40
        canvas.height = Math.round(glyph.height * scale) + 40
        const context = canvas.getContext('2d')!
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(glyph, 20, 20, canvas.width - 40, canvas.height - 40)
        return canvas.toDataURL().split(',')[1]
      })
      const language = tradition === 'Japanese' ? 'jpn' : traditionalChinese ? 'chi_tra' : 'chi_sim'
      const body = new Blob([JSON.stringify({ language, crops: images })], { type: 'application/json' })
      if (body.size > 32 * 1024 * 1024) throw new Error('识别数据上限为 32 MiB，请减少切框数量')
      const response = await localWorkbench('scan-recognition', body)
      const data = await response.json() as Omit<Recognition, 'suggestion' | 'confidence'> & {
        suggestions: Pick<Recognition, 'suggestion' | 'confidence'>[]
      }
      if (data.suggestions.length !== unreviewed.length) throw new Error('识别结果与切框数量不一致')
      const byId = new Map(unreviewed.map((crop, i) => [crop.id, {
        ...data.suggestions[i], engine: data.engine, language: data.language, model_sha256: data.model_sha256,
      }]))
      setCrops(crops.map((crop) => byId.has(crop.id) ? { ...crop, recognition: byId.get(crop.id) } : crop))
      const suggestions = data.suggestions.filter((result) => result.suggestion).length
      setStatus(suggestions + ' 个识别建议，' + (unreviewed.length - suggestions) + ' 个未识别。文字须逐字确认。')
    })
  }

  const addBox = () => {
    if (!scan || crops.length >= 200) return
    setCrops([...crops, newCandidate({
      x: 0, y: 0, width: Math.min(128, scan.canvas.width), height: Math.min(128, scan.canvas.height),
    }, nextId)])
    setActive(nextId)
    setNextId(nextId + 1)
  }
  const edit = (changes: Partial<Candidate>) =>
    setCrops(crops.map((crop) => crop.id === active ? {
      ...crop, ...changes, recognition: changes.character !== undefined ? crop.recognition : undefined,
    } : crop))
  const remove = () => {
    const remaining = crops.filter((crop) => crop.id !== active)
    setCrops(remaining)
    setActive(remaining[0]?.id)
  }
  const split = () => {
    if (!current || crops.length >= 200) return
    const side = vertical ? 'height' : 'width'
    const origin = vertical ? 'y' : 'x'
    const first = Math.floor(current[side] / 2)
    if (first < 1) return
    setCrops(crops.flatMap((crop) => crop === current ? [
      { ...crop, [side]: first, character: '', recognition: undefined },
      { ...crop, id: nextId, [origin]: crop[origin] + first, [side]: crop[side] - first, character: '', recognition: undefined },
    ] : [crop]))
    setNextId(nextId + 1)
  }
  const merge = () => {
    const index = crops.findIndex((crop) => crop.id === active)
    if (!current || index < 0 || !crops[index + 1]) return
    const other = crops[index + 1]
    const x = Math.min(current.x, other.x)
    const y = Math.min(current.y, other.y)
    const width = Math.max(current.x + current.width, other.x + other.width) - x
    const height = Math.max(current.y + current.height, other.y + other.height) - y
    setCrops(crops.flatMap((crop) => crop === current
      ? [{ ...crop, x, y, width, height, character: '', recognition: undefined }]
      : crop === other ? [] : [crop]))
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!file || !scan) return
    void run(async () => {
      if (options.mode === 'restored' && !restoration) throw new Error('请确认保存修复记录')
      const reviewed = crops.filter((crop) => crop.character.trim())
      if (!reviewed.length) throw new Error('请先人工确认至少一个字')
      const checksum = await sha256(scan.bytes.buffer)
      const records: Glyph[] = []
      let imageBytes = 0
      for (const { id: _id, character: label, recognition, ...box } of reviewed) {
        const character = label.trim()
        if (textCharacters(character).length !== 1) throw new Error('每个切框仅可确认一个字形')
        const image = cropGlyph(scan.context, box, options)
        const url = image.toDataURL()
        imageBytes += url.length
        if (imageBytes > 32 * 1024 * 1024) throw new Error('一批字形上限为 32 MiB，请分批保存')
        const asset = await sha256(await (await fetch(url)).arrayBuffer())
        const key = new TextEncoder().encode(JSON.stringify([checksum, box, character, tradition, asset]))
        const id = 'private-' + await sha256(key.buffer)
        records.push(migrateGlyph({
          id, character,
          source: { dataset: PRIVATE_DATASET, work: work.trim(), calligrapher: calligrapher.trim(),
            style: style.trim(), period: period.trim(), writing_tradition: tradition,
            language: { Japanese: 'ja', Korean: 'ko' }[tradition] || 'zh', script: unicodeScript(character),
            source_checksum: checksum, dataset_version: edition.trim(),
            rights: { derivatives_allowed: permission, redistribution_allowed: permission },
            license: permission ? '用户确认可改作及再分发' : '限本机使用',
          },
          asset: { type: 'raster', url, width: image.width, height: image.height, checksum: asset,
            bbox: [0, 0, image.width, image.height], ...(options.mode !== 'original' && { processing: 'ink-mask' }) },
          provenance: { type: 'original' },
          metadata: { original_filename: file.name, page: page.trim(), source_bbox: box,
            glyph_review: 'user-confirmed', history_unverified: true, extraction: options,
            recognition: recognition ? { ...recognition, corrected: recognition.suggestion !== character } : undefined },
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 },
          appearance: { opacity: 1, blendMode: 'source-over' },
        }))
      }
      await savePrivateGlyphs(file, checksum, records)
      await refresh()
      setStatus('已保存 ' + records.length + ' 个确认字形。空白切框仍待校对。')
    })
  }

  return <main className="materials-workspace panel-scroll">
    <section>
      <h1>字库</h1>
      <p className="field-hint">内置字体与原帖样本 · 个人字库</p>
      <details className="advanced">
        <summary>可选字库</summary>
        <ul className="private-glyphs">
          {packs.map((pack) => <li key={pack.id}>
            <span>{pack.name} · {pack.version} · {pack.count} 字形</span>
            <button disabled={busy} onClick={() => void run(async () => { await enableGlyphPack(pack.id, !pack.enabled); await refresh() })}>{pack.enabled ? '禁用' : '启用'}</button>
            <button disabled={busy} onClick={() => void run(async () => { await removeGlyphPack(pack.id); await refresh() })}>卸载</button>
          </li>)}
        </ul>
        <label className="check-field"><input type="checkbox" checked={packApproved} onChange={(event) => setPackApproved(event.target.checked)} />已核实分包来源与许可</label>
        <label>安装本机字库分包<input type="file" accept=".json" disabled={!packApproved || busy} onChange={(event) => {
          const input = event.target.files?.[0]
          event.target.value = ''
          if (input) void run(async () => {
            const { pack, glyphs } = await parseGlyphPack(input)
            const count = await installGlyphPack(pack, glyphs)
            await refresh()
            setStatus('字库已安装，共 ' + count + ' 个字形')
          })
        }} /></label>
        <a href={import.meta.env.BASE_URL + 'guide/index.html#library'}>字库导入说明</a>
      </details>
      <label>查找个人字形<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="字、书家、书体、作品或年代" /></label>
      <p className="field-hint">{available.length} 个字形 · {new Set(available.map((glyph) => glyph.character)).size} 个不同字</p>
      <ul className="private-glyphs">
        {available.map((glyph) => <li key={glyph.id}>
          <button onClick={() => addGlyph(glyph)} title="加入作品"><img src={glyph.asset.url} alt={glyph.character} />{glyph.character}</button>
          <button onClick={() => void run(async () => {
            const original = await originalScan(glyph.source.source_checksum!)
            if (!original) throw new Error('找不到本机原图')
            await saveFile(String(glyph.metadata?.original_filename || 'source-image'), original)
          })}>原图</button>
          <button onClick={() => void run(async () => { await deletePrivateGlyph(glyph.id); await refresh() })}>移除</button>
        </li>)}
      </ul>
    </section>
    <form onSubmit={save}>
      <h1>碑帖提取</h1>
      <fieldset className="scan-fields" disabled={busy}>
        <label>原图<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
          const image = event.target.files?.[0]
          if (image) void read(image)
        }} /></label>
        {scan && <>
          <div className="field-grid">
            <label>传统<select value={tradition} onChange={(event) => setTradition(event.target.value)}>
              <option value="Chinese">中文</option><option value="Japanese">日本語</option><option value="Korean">한국어</option>
            </select></label>
            <label>切字方向<select value={vertical ? 'vertical' : 'horizontal'} onChange={(event) => setVertical(event.target.value === 'vertical')}>
              <option value="vertical">竖排，从右向左</option><option value="horizontal">横排，从左向右</option>
            </select></label>
            <label>图像处理<select value={options.mode} onChange={(event) => setOptions({ ...options, mode: event.target.value as InkOptions['mode'] })}>
              <option value="original">原貌</option><option value="clean">净底</option><option value="restored">修复单像素断点</option>
            </select></label>
            <label>墨迹极性<select value={options.polarity} onChange={(event) => setOptions({ ...options, polarity: event.target.value as InkOptions['polarity'] })}>
              <option value="auto">自动</option><option value="dark">黑字</option><option value="light">白字</option>
            </select></label>
            <label>墨迹阈值<input type="number" min="0" max="100" value={options.threshold} onChange={(event) => setOptions({ ...options, threshold: Number(event.target.value) })} /></label>
            <label>留白 (px)<input type="number" min="0" max="256" value={options.padding} onChange={(event) => setOptions({ ...options, padding: Number(event.target.value) })} /></label>
          </div>
          <div className="scan-actions">
            <button type="button" onClick={locate}>自动定位</button>
            <button type="button" onClick={addBox}>新增切框</button>
          </div>
          <details className="advanced">
            <summary>实验性识别建议（可选）</summary>
            <p className="field-hint">模型面向现代印刷字。历史碑帖请手工切框和校对。识别建议不会自动入库。</p>
            <CompanionControls onStatus={setCompanion} />
            {companion.ready && !companion.ocr && <p className="field-hint">需要在独立 Companion 中配置本机 OCR 模型。请参阅教程。</p>}
            {companion.ocr && <>
              {tradition === 'Chinese' && <label className="check-field">
                <input type="checkbox" checked={traditionalChinese} onChange={(event) => setTraditionalChinese(event.target.checked)} />识别繁体
              </label>}
              <div className="scan-actions"><button type="button" disabled={tradition === 'Korean' || crops.every((crop) => crop.character.trim())} onClick={recognize}>实验识别待校对字</button></div>
              {tradition === 'Korean' && <p className="field-hint">韩文素材支持手动切框、校对和入库。</p>}
            </>}
          </details>
          <div className="scan-page">
            <img src={pagePreview} alt="碑帖原图" />
            {crops.map((crop, index) => <button type="button" key={crop.id} className="scan-box"
              aria-pressed={active === crop.id} aria-label={'切框 ' + (index + 1)} onClick={() => setActive(crop.id)}
              style={{ left: crop.x / scan.canvas.width * 100 + '%', top: crop.y / scan.canvas.height * 100 + '%',
                width: crop.width / scan.canvas.width * 100 + '%', height: crop.height / scan.canvas.height * 100 + '%' }}>
              {crop.character || index + 1}
            </button>)}
          </div>
          <label>选择切框<select value={active ?? ''} onChange={(event) => setActive(event.target.value ? Number(event.target.value) : undefined)}>
            <option value="">请选择</option>
            {crops.map((crop, index) => <option key={crop.id} value={crop.id}>{index + 1} · {crop.character || '待校对'}</option>)}
          </select></label>
          {current && <>
            <Preview scan={scan} box={{ x: current.x, y: current.y, width: current.width, height: current.height }} options={options} />
            <div className="field-grid">
              {([['x', '左'], ['y', '上'], ['width', '宽'], ['height', '高']] as const).map(([key, label]) =>
                <label key={key}>{label} (px)<input type="number" min={key === 'x' || key === 'y' ? 0 : 1} value={current[key]} onChange={(event) => edit({ [key]: Number(event.target.value) })} /></label>)}
            </div>
            {current.recognition && <p className="field-hint">{current.recognition.suggestion
              ? <>识别建议 {current.recognition.suggestion} · 置信分 {current.recognition.confidence}{' '}
                  <button type="button" onClick={() => edit({ character: current.recognition!.suggestion! })}>采用建议</button></>
              : '识别结果不确定，请人工录入'}</p>}
            <label>确认文字<input value={current.character} maxLength={32} onChange={(event) => edit({ character: event.target.value })} /></label>
            <div className="scan-actions">
              <button type="button" onClick={split}>拆分</button>
              <button type="button" onClick={merge}>与下一框合并</button>
              <button type="button" onClick={remove}>删除切框</button>
            </div>
          </>}
          <details className="advanced">
            <summary>原帖资料</summary>
            <div className="field-grid">
              <label>作品<input value={work} maxLength={256} onChange={(event) => setWork(event.target.value)} /></label>
              <label>页码<input value={page} maxLength={32} onChange={(event) => setPage(event.target.value)} /></label>
              <label>版本<input value={edition} maxLength={120} onChange={(event) => setEdition(event.target.value)} /></label>
              <label>书家<input value={calligrapher} maxLength={120} onChange={(event) => setCalligrapher(event.target.value)} /></label>
              <label>书体<input value={style} maxLength={120} onChange={(event) => setStyle(event.target.value)} /></label>
              <label>年代<input value={period} maxLength={120} onChange={(event) => setPeriod(event.target.value)} /></label>
            </div>
          </details>
          {options.mode === 'restored' && <label className="check-field">
            <input type="checkbox" checked={restoration} onChange={(event) => setRestoration(event.target.checked)} />确认保存处理过的修复字形
          </label>}
          <label className="check-field"><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} />已核实允许改作与再分发</label>
          <button className="materials-save" type="submit">保存确认字形</button>
        </>}
      </fieldset>
      <p role="status">{status}</p>
    </form>
  </main>
}
