import { uiText } from "../../i18n"
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getMetadata, searchGlyphs } from '../../api/client'
import { fontGlyphs } from '../../api/fonts'
import { useEditorStore } from '../../stores/editor'
import type { Glyph, MetadataResponse } from '../../types'
import { RegionalFontFallback, RegionalFontSelect } from './RegionalFontSelect'
import { SourcePolicyControls } from './SourcePolicyControls'
import { usesRegionalFonts, DEFAULT_POLICY, candidateCompatible, type CandidatePolicy } from '../../lib/candidatePolicy'
import { textCharacters } from '../../lib/identity'
import { packedGlyphs, installedPacks, privateGlyphs, PRIVATE_DATASET } from '../../lib/privateLibrary'
import { historicalSample } from '../../api/historical'

function initialSearchPolicy(project?: CandidatePolicy): CandidatePolicy {
  if (!project) return DEFAULT_POLICY
  const { writing_tradition, locale, mode, font_id, allow_font_fallback } = project
  return { writing_tradition, locale, mode, font_id, allow_font_fallback }
}

export const GLYPH_DRAG_TYPE = 'application/x-calligraphy-glyph'
export function GlyphBrowser({ active: visible }: { active: boolean }) {
  const [query, setQuery] = useState('山')
  const projectPolicy = useEditorStore((s) => s.project.composition?.policy)
  const vertical = useEditorStore((s) => s.project.composition?.layout === 'vertical-rtl')
  const [policy, setPolicy] = useState<CandidatePolicy>(() => initialSearchPolicy(projectPolicy))
  const [style, setStyle] = useState('')
  const [dataset, setDataset] = useState('')
  const [calligrapher, setCalligrapher] = useState('')
  const [results, setResults] = useState<Glyph[]>([])
  const [meta, setMeta] = useState<MetadataResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [limit, setLimit] = useState(40)
  const [total, setTotal] = useState(0)
  const [retry, setRetry] = useState(0)
  const [packNames, setPackNames] = useState<string[]>([])
  const addGlyph = useEditorStore((s) => s.addGlyph)
  const regional = usesRegionalFonts(policy.writing_tradition)
  function clearFilters() {
    setStyle('')
    setDataset('')
    setCalligrapher('')
    setLimit(40)
  }
  useEffect(() => {
    setPolicy(initialSearchPolicy(projectPolicy))
    clearFilters()
  }, [projectPolicy])
  useEffect(() => {
    if (!visible) return
    void installedPacks().then((packs) => setPackNames(packs.filter((pack) => pack.enabled).map((pack) => pack.name))).catch(() => undefined)
    getMetadata(policy.mode === 'cross-tradition' ? '*' : policy.writing_tradition)
      .then(setMeta)
      .catch(() => undefined)
  }, [policy.writing_tradition, policy.mode, visible])
  useEffect(() => {
    if (!visible) return
    let active = true
    setLoading(true)
    const timer = setTimeout(async () => {
      const term = query.trim()
      const effectiveStyle = regional ? '' : style
      const fontOnly = Boolean(policy.font_id)
      const fontPolicy = { ...policy, dataset: dataset || undefined, vertical: regional && vertical }
      if (dataset === 'Japanese Coverage Fonts' || dataset === 'Korean Coverage Fonts') fontPolicy.allow_font_fallback = true
      const [library, fonts, historical, local] = await Promise.allSettled([
        fontOnly || dataset === PRIVATE_DATASET || packNames.includes(dataset)
          ? Promise.resolve({ items: [], total: 0 })
          : searchGlyphs({ q: term, style: effectiveStyle, dataset, calligrapher, limit, ...policy, writing_tradition: policy.mode === 'cross-tradition' ? undefined : policy.writing_tradition }),
        textCharacters(term).length === 1
          ? fontGlyphs(term, effectiveStyle, calligrapher, fontPolicy)
          : Promise.resolve([]),
        fontOnly ? Promise.resolve([]) : historicalSample().then((items) => items.filter((g) => (!term || g.character === term || g.source.work?.includes(term)) && (!dataset || g.source.dataset === dataset) && candidateCompatible(g, policy))),
        fontOnly ? Promise.resolve([]) : Promise.all([
          !dataset || dataset === PRIVATE_DATASET ? privateGlyphs(undefined, policy) : Promise.resolve([]),
          dataset === PRIVATE_DATASET ? Promise.resolve([]) : packedGlyphs(undefined, { ...policy, dataset: dataset || undefined }),
        ]).then((groups) => groups.flat()).then((items) =>
          items.filter((glyph) => (!term || glyph.character === term ||
            [glyph.source.work, glyph.source.calligrapher, glyph.source.style, glyph.source.period].some((value) => value?.includes(term))) &&
            (!effectiveStyle || glyph.source.style === effectiveStyle) &&
            (!calligrapher || glyph.source.calligrapher === calligrapher))
        ),
      ])
      if (!active) return
      const generated = fonts.status === 'fulfilled' ? fonts.value : []
      const stored = [...(library.status === 'fulfilled' ? library.value.items : []), ...(historical.status === 'fulfilled' ? historical.value : [])]
      const privateItems = local.status === 'fulfilled' ? local.value : []
      const items = [
        ...generated,
        ...privateItems.slice(0, limit),
        ...stored.filter(
          (g) =>
            !generated.some((f) => f.character === g.character && f.source.work === g.source.work),
        ),
      ]
      setResults(Array.from(new Map(items.filter((g) => fontOnly || candidateCompatible(g, fontPolicy)).map((g) => [g.variant?.id || g.id,g])).values()))
      setTotal(Math.max(privateItems.length, library.status === 'fulfilled' ? library.value.total : 0))
      setMessage(
        library.status === 'rejected'
          ? (generated.length || privateItems.length)
            ? uiText("原帖服务未连接，当前显示本机字形。")
            : uiText("字库未连接，请检查服务，或输入单个字查询内置字体。")
          : fonts.status === 'rejected'
            ? uiText("内置字体加载失败，请重试。")
            : '',
      )
      setLoading(false)
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, style, dataset, calligrapher, limit, retry, policy, visible, packNames, regional, vertical])
  return (
    <div className="glyph-browser panel-scroll">
      <div className="section-title">
        <span>{results.length} {uiText("个结果")}</span>
      </div>
      <div className="search-field">
        <Search size={16} />
        <input
          aria-label={uiText("搜索字形")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(40)
          }}
          placeholder={policy.writing_tradition === 'Korean' ? uiText("韩文、汉字、书家或作品") : regional ? uiText("汉字、假名、书家或作品") : uiText("汉字、书家或作品")}
        />
      </div>
      <div className="field-grid">
        <label>{uiText("来源类型 / Source type")}<select aria-label="Source type" value={policy.provenance_type || ''} onChange={(e) => setPolicy({ ...policy, provenance_type: e.target.value || undefined, font_id: e.target.value === 'font' ? policy.font_id : undefined })}><option value="">{uiText("全部 / All")}</option><option value="font">{uiText("字体 / Font")}</option><option value="original">{uiText("原帖 / Historical original")}</option><option value="fallback">{uiText("结构 / Structural fallback")}</option></select></label>
      </div>
      <SourcePolicyControls policy={policy} onChange={(value) => {
        if (value.writing_tradition !== policy.writing_tradition) clearFilters()
        setPolicy(value)
        setLimit(40)
      }} />
      <div className="field-grid">
        {regional ? <RegionalFontSelect policy={policy} onChange={(next) => {
          setPolicy(next)
          clearFilters()
        }} /> : <label>
          {uiText("书体")}
          <select aria-label={uiText("书体")} value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">{uiText("全部书体")}</option>
            <option value="楷书">{uiText("楷书")}</option>
            <option value="行书">{uiText("行书")}</option>
            <option value="草书">{uiText("草书")}</option>
          </select>
        </label>}
        <label>
          {uiText("来源")}
          <select
            aria-label={uiText("字库来源")}
            disabled={!!policy.font_id}
            value={dataset}
            onChange={(e) => setDataset(e.target.value)}
          >
            <option value="">{uiText("全部字库")}</option>
            {[...new Set([...(meta?.datasets || ['OFL Calligraphy Fonts']), PRIVATE_DATASET, ...packNames])].map((item) => (
              <option key={item}>{item === PRIVATE_DATASET ? uiText(item) : item}</option>
            ))}
          </select>
        </label>
      </div>
      {regional && !dataset && <RegionalFontFallback policy={policy} onChange={setPolicy} />}
      <details className="advanced">
        <summary>{uiText("筛选书家")}</summary>
        <select
          aria-label={uiText("书家筛选")}
          disabled={!!policy.font_id}
          value={calligrapher}
          onChange={(e) => setCalligrapher(e.target.value)}
        >
          <option value="">{uiText("全部书家")}</option>
          {meta?.calligraphers.map((item) => (
            <option key={item.id}>{item.name}</option>
          ))}
        </select>
      </details>
      {loading ? (
        <p className="feedback" role="status">
          {uiText("正在查字…")}
        </p>
      ) : (
        <>
          {message && (
            <div className="feedback" role="status">
              {message}
              <button onClick={() => setRetry(retry + 1)}>{uiText("重试")}</button>
            </div>
          )}
          {!results.length && !message && (
            <p className="feedback">{policy.font_id
              ? uiText("所选字体未找到匹配字形。可更换字体，或允许缺字补字。")
              : uiText("未找到字形。试试输入单个字，或修改筛选条件。")}</p>
          )}
          <div className="glyph-grid">
            {results.map((glyph) => (
              <button
                key={glyph.id}
                className="glyph-card"
                draggable
                onClick={() => addGlyph(glyph)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy'
                  e.dataTransfer.setData(GLYPH_DRAG_TYPE, JSON.stringify(glyph))
                }}
                title={`${glyph.character} · ${glyph.source.work || glyph.source.dataset}`}
              >
                <img loading="lazy" src={glyph.asset.url} alt={glyph.character} draggable={false} />
                <div>
                  <span>{glyph.source.style}</span>
                </div>
                <small>{glyph.source.work || glyph.source.dataset}</small>
                <small className="glyph-kind">
                  {glyph.source.writing_tradition || 'Unknown tradition'} ·{' '}
                  {glyph.source.source_role === 'coverage-fallback' ? 'Coverage fallback' : glyph.source.source_role === 'handwriting' ? 'Handwriting' : glyph.source.source_role === 'calligraphy' ? 'Calligraphy' : glyph.source.dataset === 'Demo'
                    ? uiText("演示字形")
                    : { font: uiText("字体"), original: glyph.metadata?.history_unverified ? uiText("本机导入") : uiText("原帖"), fallback: uiText("结构替补"), generated: uiText("生成") }[
                        glyph.provenance.type
                      ]}{' '}
                  · {glyph.source.license || uiText("授权未标注")}
                </small>
              </button>
            ))}
          </div>
          {total > limit && (
            <button className="load-more" onClick={() => setLimit(limit + 40)}>
              {uiText("加载更多（共")} {total} {uiText("个）")}
            </button>
          )}
        </>
      )}
    </div>
  )
}
