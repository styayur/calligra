import { uiText } from "../../i18n"
import { useEffect, useRef, useState } from 'react'
import {
  initialCandidates,
  resolveCharacters,
  type CandidateSource,
} from '../../api/candidates'
import { getVisualProfile } from '../../lib/featureCache'
import { selectSequence, type ProfileCandidate } from '../../lib/beam'
import {
  FEATURE_VERSION,
  harmonyScore,
  profileCost,
  type VisualProfile,
} from '../../lib/visual'
import {
  paginateRoll,
  renderRollPage,
  rollArtwork,
  zipFiles,
  type RollOptions,
  type RollPage,
} from '../../lib/longRoll'
import { textLines } from '../../lib/composition'
import { saveFile } from '../../lib/download'
import { useEditorStore } from '../../stores/editor'
import type { Glyph } from '../../types'
import { usesRegionalFonts, DEFAULT_POLICY, type CandidatePolicy } from '../../lib/candidatePolicy'
import { RegionalFontFallback, RegionalFontSelect } from '../glyph-browser/RegionalFontSelect'
import { SourcePolicyControls } from '../glyph-browser/SourcePolicyControls'
import { assertExportRights, attributionFiles } from '../../lib/rights'
import { PDF_PAPER, PdfSettings } from '../editor/PdfSettings'
import type { TextLanguage } from '../../types'
import type { AdvancedTypography } from '../../types/typesetting'
import { TypographyControls } from '../glyph-browser/TypographyControls'
import { typesetScroll } from '../../lib/typesetComposition'

interface RollResult {
  pages: RollPage[]
  options: RollOptions
  text: string
  missing: { character: string; positions: number[] }[]
  warnings: string[]
  score: number | null
  singleVariants: number
  source: CandidateSource
  style: string
  beam: number
  variation: number
  policy: CandidatePolicy
  typography?: AdvancedTypography
  language?: TextLanguage
}
function PagePreview({
  page,
  options,
  number,
}: {
  page: RollPage
  options: RollOptions
  number: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    if (canvas.current)
      void renderRollPage(page, options, canvas.current, 1, controller.signal).catch((e) => {
        if (!controller.signal.aborted) setError(String(e))
      })
    return () => controller.abort()
  }, [page, options])
  return (
    <figure className="roll-page">
      <canvas ref={canvas} aria-label={uiText("长卷第 {{v0}} 页", { v0: number })} />
      <figcaption>
        {uiText("第")} {number} {uiText("页 ·")} {page.slots.length} {uiText("字")}{error && ` · ${error}`}
      </figcaption>
    </figure>
  )
}
export function LongRoll({ active }: { active: boolean }) {
  const [pdfPaper, setPdfPaper] = useState(PDF_PAPER)
  const [policy, setPolicy] = useState<CandidatePolicy>(() => useEditorStore.getState().project.composition?.policy || DEFAULT_POLICY)
  const [text, setText] = useState(
    () => useEditorStore.getState().project.text || '明月松间照\n清泉石上流',
  )
  const [rows, setRows] = useState(12),
    [columns, setColumns] = useState(8),
    [vertical, setVertical] = useState(true),
    [punctuation, setPunctuation] = useState(false)
  const [style, setStyle] = useState(''),
    [source, setSource] = useState<CandidateSource>('fonts'),
    [beam, setBeam] = useState(8),
    [variation, setVariation] = useState(0.2)
  const [typography, setTypography] = useState<AdvancedTypography | undefined>(() => {
    const settings = useEditorStore.getState().project.composition?.typography
    return settings && { ...settings, flow: settings.flow && { ...settings.flow, pins: [] } }
  })
  const [result, setResult] = useState<RollResult | null>(null),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [scroll, setScroll] = useState(0),
    [viewport, setViewport] = useState(800)
  const controller = useRef<AbortController | null>(null),
    scroller = useRef<HTMLDivElement>(null),
    textInput = useRef<HTMLTextAreaElement>(null)
  const changeText = (value: string) => {
    setText(value)
    setTypography((previous) => previous && { ...previous, tcy: [], spans: undefined })
  }
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (!active || !scroller.current) return
    const observer = new ResizeObserver(([entry]) => setViewport(entry.contentRect.height))
    observer.observe(scroller.current)
    return () => observer.disconnect()
  }, [active, result])
  const count = textLines(text, punctuation || Boolean(typography)).flat().length
  const generate = async () => {
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    try {
      const options = { rows, columns, vertical, punctuation }
      if (typography) {
        const language = useEditorStore.getState().project.composition?.textLanguage || 'und'
        const tradition = policy.writing_tradition === 'Japanese' || policy.writing_tradition === 'Korean'
          ? policy.writing_tradition : 'Chinese'
        const shaped = await typesetScroll(text, {
          ...options, ...typography, layout: vertical ? 'vertical-rtl' : 'horizontal-ltr',
          language, tradition, signal: abort.signal,
          source, style, policy,
        })
        setResult({ ...shaped, options, text, source, style, beam, variation, policy, typography, language,
          warnings: [], score: null, singleVariants: 0 })
        setScroll(0)
        if (scroller.current) scroller.current.scrollTop = 0
        setStatus(uiText("已生成 {{v0}} 字 / {{v1}} 页；缺字 {{v2}} 处。", {
          v0: shaped.count, v1: shaped.pages.length, v2: shaped.missing.reduce((sum, item) => sum + item.positions.length, 0),
        }))
        return
      }
      const pages = paginateRoll(text, options),
        characters = pages.flatMap((p) => p.slots.map((s) => s.character))
      const warnings = new Set<string>(),
        byId = new Map<string, Glyph>(),
        profileById = new Map<string, VisualProfile>()
      const candidates = await resolveCharacters(
        characters,
        async (character) => {
          const page = await initialCandidates(character, source, usesRegionalFonts(policy.writing_tradition) ? '' : style, 8, abort.signal, { ...policy, vertical })
          if (page.warning) warnings.add(page.warning)
          const items: ProfileCandidate[] = []
          for (const g of page.items.slice(0, 8)) {
            abort.signal.throwIfAborted()
            try {
              const profile = await getVisualProfile(g)
              if (profile.empty) continue
              byId.set(g.id, g)
              profileById.set(g.id, profile)
              items.push({ id: g.id, character, profile, glyph: g })
            } catch {
              warnings.add(uiText("「{{v0}}」部分候选无法分析", { v0: character }))
            }
          }
          return items
        },
        (done, total) => setStatus(uiText("准备字形与特征 {{v0}}/{{v1}} 个不同字", { v0: done, v1: total })),
        abort.signal,
      )
      if (!byId.size) throw new Error(uiText("未找到可用字形，请更换字库或书体。"))
      // Fixed representative context, independent of beam paths, deterministic across runs.
      const context = [...candidates.values()]
        .filter((c) => c.length)
        .slice(0, 24)
        .map((c) => c[0].profile)
      const chosen = await selectSequence(characters, candidates, context, {
        width: beam,
        variation,
        policy,
        signal: abort.signal,
        progress: (done) => setStatus(uiText("自动选字 {{v0}}/{{v1}}", { v0: done, v1: characters.length })),
      })
      const missing = new Map<string, number[]>(),
        costs: number[] = []
      for (const page of pages)
        for (const slot of page.slots) {
          const id = chosen[slot.index]
          if (!id) {
            missing.set(slot.character, [
              ...(missing.get(slot.character) || []),
              slot.index + 1,
            ])
            continue
          }
          slot.glyph = byId.get(id)!
          const neighbors = chosen
            .slice(Math.max(0, slot.index - 4), slot.index)
            .concat(chosen.slice(slot.index + 1, slot.index + 5))
            .flatMap((n) => (n ? [profileById.get(n)!] : []))
          slot.cost = neighbors.length ? profileCost(profileById.get(id)!, neighbors) : null
          if (slot.cost !== null) costs.push(slot.cost)
        }
      abort.signal.throwIfAborted()
      setResult({
        pages,
        options,
        text,
        source,
        style,
        beam,
        variation,
        policy,
        missing: [...missing].map(([character, positions]) => ({
          character,
          positions,
        })),
        warnings: [...warnings],
        score: costs.length
          ? harmonyScore(costs.reduce((a, b) => a + b, 0) / costs.length)
          : null,
        singleVariants: [...candidates.values()].filter((v) => v.length === 1).length,
      })
      setScroll(0)
      if (scroller.current) scroller.current.scrollTop = 0
      setStatus(
        uiText("已生成 {{v0}} 字 / {{v1}} 页；缺字 {{v2}} 处。", { v0: characters.length, v1: pages.length, v2: [...missing.values()].reduce((s, p) => s + p.length, 0) }),
      )
    } catch (e) {
      setStatus(
        abort.signal.aborted
          ? uiText("已取消，保留上次生成结果。")
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setBusy(false)
    }
  }
  const exportAll = async () => {
    if (!result) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    try {
      const selectedGlyphs = result.pages.flatMap((p) => p.slots.flatMap((s) => s.glyph ? [s.glyph] : []))
      assertExportRights(selectedGlyphs, { commercialOnly: result.policy.commercial_only })
      const files: { name: string; data: Uint8Array }[] = [],
        canvas = document.createElement('canvas'),
        encoder = new TextEncoder()
      for (let i = 0; i < result.pages.length; i++) {
        abort.signal.throwIfAborted()
        setStatus(uiText("导出第 {{v0}}/{{v1}} 页…", { v0: i + 1, v1: result.pages.length }))
        await renderRollPage(result.pages[i], result.options, canvas, 1, abort.signal)
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error(uiText("页面导出失败")))),
            'image/png',
          ),
        )
        files.push({
          name: `pages/${String(i + 1).padStart(4, '0')}.png`,
          data: new Uint8Array(await blob.arrayBuffer()),
        })
        await new Promise((r) => setTimeout(r, 0))
      }
      const glyphs = Object.fromEntries(
        result.pages.flatMap((p) =>
          p.slots.flatMap((s) => (s.glyph ? [[s.glyph.id, s.glyph]] : [])),
        ),
      )
      const manifest = {
        version: 2,
        featureVersion: FEATURE_VERSION,
        text: result.text,
        options: result.options,
        selection: {
          source: result.source,
          style: result.style,
          beam: result.beam,
          variation: result.variation,
          policy: result.policy,
          typography: result.typography,
          language: result.language,
        },
        score: result.score,
        missing: result.missing,
        warnings: result.warnings,
        glyphs,
        pages: result.pages.map((p) => ({
          runs: p.runs,
          flowCosts: p.flowCosts,
          slots: p.slots.map((s) => ({
            ...s, glyph: s.glyph?.id || null, position: p.measured ? s.glyph?.transform : undefined,
          })),
        })),
      }
      files.push(
        {
          name: 'manifest.json',
          data: encoder.encode(JSON.stringify(manifest, null, 2)),
        },
        {
          name: 'missing.csv',
          data: encoder.encode(
            '\ufeffcharacter,positions\n' +
              result.missing
                .map((m) => `"${m.character.replaceAll('"', '""')}","${m.positions.join(' ')}"`)
                .join('\n'),
          ),
        },
      )
      files.push(...await attributionFiles(selectedGlyphs, { commercialOnly: result.policy.commercial_only }))
      abort.signal.throwIfAborted()
      await saveFile(uiText("长卷作品.zip"), zipFiles(files))
      setStatus(uiText("已导出全部页面、缺字列表和字形来源清单。"))
    } catch (e) {
      setStatus(abort.signal.aborted ? uiText("导出已取消。") : String(e))
    } finally {
      setBusy(false)
    }
  }
  const exportPdf = async () => {
    if (!result) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    try {
      const { buildHybridPdf } = await import('../../lib/hybridPdf')
      const pdf = await buildHybridPdf(result.pages.map((page) => rollArtwork(page, result.options)), {
        ...pdfPaper, commercialOnly: result.policy.commercial_only, signal: abort.signal,
        originalText: result.text, restoration: result.missing,
        progress: (page, total) => setStatus(uiText("导出第 {{v0}}/{{v1}} 页…", { v0: page, v1: total })),
      })
      abort.signal.throwIfAborted()
      await saveFile('Calligra-Scroll.pdf', pdf.blob)
      setStatus(uiText('PDF 已导出，最低图像分辨率 {{dpi}} DPI', { dpi: pdf.statistics.minimumDpi?.toFixed(0) ?? '—' }))
    } catch (error) {
      setStatus(abort.signal.aborted ? uiText("导出已取消。") : String(error))
    } finally {
      setBusy(false)
    }
  }
  const first = Math.max(0, Math.floor(scroll / 580) - 1),
    last = Math.min(result?.pages.length || 0, Math.ceil((scroll + viewport) / 580) + 1)
  const anomalies =
    result?.pages.flatMap((p, page) =>
      p.slots.filter((s) => (s.cost ?? 0) > 0.28).map((s) => ({ ...s, page })),
    ) || []
  return (
    <main className={active ? 'long-roll' : 'hidden'} aria-label={uiText("长卷模式")}>
      <aside className="roll-controls panel-scroll">
        <h2>{uiText("长卷模式")}</h2>
        <p className="field-hint">
          {uiText("自动选字、分栏、分页。适合 1000 字以上作品，预览按页浏览，不提供逐字拖动。")}
        </p>
        <fieldset disabled={busy}>
          <SourcePolicyControls policy={policy} onChange={setPolicy} />
          <label>
            {uiText("长卷内容")} <span>{count} {uiText("/ 20000 字")}</span>
            <textarea
              ref={textInput}
              aria-label={uiText("长卷内容")}
              rows={8}
              value={text}
              onChange={(e) => changeText(e.target.value)}
            />
          </label>
          <button
            className="load-more"
            onClick={() => changeText(useEditorStore.getState().project.text || '')}
          >
            {uiText("从工作台读取文字")}
          </button>
          <div className="field-grid">
            <label>
              {uiText("来源 / Source")}
              <select
                aria-label={uiText("长卷字形来源")}
                value={source}
                onChange={(e) => {
                  setSource(e.target.value as CandidateSource)
                  setPolicy({ ...policy, font_id: undefined, allow_font_fallback: undefined })
                }}
              >
                <option value="fonts">{uiText("字体 / Font")}</option>
                <option value="original">{uiText("原帖 / Original")}</option>
                <option value="all">{uiText("全部")}</option>
              </select>
            </label>
            {usesRegionalFonts(policy.writing_tradition) ? <RegionalFontSelect policy={policy} onChange={(next) => {
              setPolicy(next)
              setSource('fonts')
            }} /> : <label>
              {uiText("书体")}
              <select
                aria-label={uiText("长卷书体")}
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              >
                <option value="">{uiText("全部书体")}</option>
                <option value="楷书">{uiText("楷书")}</option>
                <option value="行书">{uiText("行书")}</option>
                <option value="草书">{uiText("草书")}</option>
              </select>
            </label>}
          </div>
          {usesRegionalFonts(policy.writing_tradition) && source !== 'original' &&
            <RegionalFontFallback policy={policy} onChange={setPolicy} />}
          <div className="field-grid">
            <label>
              {uiText("每页行数")}
              <input
                aria-label={uiText("长卷每页行数")}
                type="number"
                min="2"
                max="24"
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
              />
            </label>
            <label>
              {uiText("每页列数")}
              <input
                aria-label={uiText("长卷每页列数")}
                type="number"
                min="2"
                max="24"
                value={columns}
                onChange={(e) => setColumns(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={vertical}
              onChange={(e) => setVertical(e.target.checked)}
            />
            {uiText("竖排，从右向左分栏")}
          </label>
          {!typography && <label className="check-field">
            <input
              type="checkbox"
              checked={punctuation}
              onChange={(e) => setPunctuation(e.target.checked)}
            />
            {uiText("保留标点")}
          </label>}
          <TypographyControls value={typography} onChange={setTypography} input={textInput} vertical={vertical} />
          {!typography && <><label className="slider-field">
            {uiText("重复字变化")} {variation.toFixed(2)}
            <input
              aria-label={uiText("重复字变化")}
              type="range"
              min="0"
              max="1"
              step=".05"
              value={variation}
              onChange={(e) => setVariation(Number(e.target.value))}
            />
          </label>
          <details className="advanced">
            <summary>{uiText("自动选字设置")}</summary>
            <label>
              {uiText("搜索宽度")}
              <select value={beam} onChange={(e) => setBeam(Number(e.target.value))}>
                <option value="1">{uiText("快速（1）")}</option>
                <option value="4">{uiText("均衡（4）")}</option>
                <option value="8">{uiText("精细（8）")}</option>
                <option value="16">{uiText("更精细（16）")}</option>
              </select>
            </label>
            <p className="field-hint">
              {uiText("每个不同字最多分析 8 个候选。综合整段参照、相邻字形差异和最近 32 字的重复情况；只有一个候选时保持原样。")}
            </p>
          </details></>}
          <button
            className="roll-primary"
            disabled={busy || !count || count > 20000}
            onClick={generate}
          >
            {uiText("自动生成长卷")}
          </button>
        </fieldset>
        {busy && (
          <button className="load-more" onClick={() => controller.current?.abort()}>
            {uiText("取消当前任务")}
          </button>
        )}
        <p className="feedback" role="status">
          {status || uiText("输入文字后开始生成。换行会另起一栏或一行。")}
        </p>
        {result && (
          <>
            <button className="roll-primary" disabled={busy} onClick={exportPdf}>{uiText('导出多页 PDF')}</button>
            <PdfSettings value={pdfPaper} onChange={setPdfPaper} />
            <button className="load-more" disabled={busy} onClick={exportAll}>
              {uiText("批量导出 ZIP")}
            </button>
            <p className="field-hint">
              {uiText("每页 PNG 800 × 1100，附来源与位置清单、缺字 CSV。请导出以保存本次长卷。")}
            </p>
            <h3>{uiText("作品协调度")} {result.score ?? '—'} / 100</h3>
            <p className="field-hint">
              {uiText("局部字形相近度，非审美评分。")}{result.singleVariants} {uiText("个不同字只有一种候选。")}
            </p>
            <details open={result.missing.length > 0}>
              <summary>{uiText("缺字列表（")}{result.missing.length} {uiText("种）")}</summary>
              {result.missing.length ? (
                result.missing.map((m) => (
                  <p key={m.character}>
                    {m.character} · {m.positions.length} {uiText("处 · 位置")}{' '}
                    {m.positions.slice(0, 20).join('、')}
                    {m.positions.length > 20 ? '…' : ''}
                  </p>
                ))
              ) : (
                <p>{uiText("没有缺字。")}</p>
              )}
            </details>
            <details>
              <summary>{uiText("异常字检测（")}{anomalies.length} {uiText("处）")}</summary>
              <p className="field-hint">{uiText("与前后最多 8 字的平均差异超过 28%；仅供复核。")}</p>
              {anomalies.slice(0, 100).map((s) => (
                <button
                  className="anomaly-link"
                  key={s.index}
                  onClick={() => {
                    scroller.current?.scrollTo({ top: s.page * 580 })
                    setScroll(s.page * 580)
                  }}
                >
                  {uiText("第")} {s.index + 1} {uiText("字「")}{s.character}{uiText("」· 第")} {s.page + 1} {uiText("页 ·")}{' '}
                  {harmonyScore(s.cost!)} {uiText("分")}
                </button>
              ))}
              {anomalies.length > 100 && <p>{uiText("这里只显示前 100 处，完整差异在导出清单中。")}</p>}
            </details>
            {result.warnings.map((w) => (
              <p className="field-hint" key={w}>
                {w}
              </p>
            ))}
          </>
        )}
      </aside>
      <section
        className="roll-preview panel-scroll"
        ref={scroller}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        aria-label={uiText("长卷分页预览")}
      >
        {result ? (
          <div style={{ height: result.pages.length * 580, position: 'relative' }}>
            {result.pages.slice(first, last).map((page, i) => (
              <div
                key={first + i}
                style={{
                  position: 'absolute',
                  top: (first + i) * 580,
                  height: 580,
                  width: '100%',
                }}
              >
                <PagePreview page={page} options={result.options} number={first + i + 1} />
              </div>
            ))}
          </div>
        ) : (
          <div className="roll-empty">
            <span>{uiText("卷")}</span>
            <h2>{uiText("让千字成篇")}</h2>
            <p>{uiText("分页预览 · 自动选字 · 重复字变化")}</p>
          </div>
        )}
      </section>
    </main>
  )
}
