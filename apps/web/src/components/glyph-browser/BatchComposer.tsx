import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { initialCandidates, resolveCharacters, type CandidateSource } from '../../api/candidates'
import { JapaneseFontFallback, JapaneseFontSelect } from './JapaneseFontSelect'
import { SourcePolicyControls } from './SourcePolicyControls'
import { DEFAULT_POLICY, type CandidatePolicy } from '../../lib/candidatePolicy'
import { layoutText, placeGlyph, textLines, validLayoutDimensions } from '../../lib/composition'
import { useEditorStore } from '../../stores/editor'
import type { BatchLayout, CompositionSettings, Glyph } from '../../types'
import { Button } from '../ui'
import { installedPacks } from '../../lib/privateLibrary'

const DEFAULT_SETTINGS: CompositionSettings = {
  layout: 'vertical-rtl', columns: 5, size: 160, gap: 12, margin: 64,
  punctuation: false, style: '行书', source: 'fonts', policy: DEFAULT_POLICY,
}

export function BatchComposer({ active }: { active: boolean }) {
  const projectText = useEditorStore((s) => s.project.text)
  const settings = useEditorStore((s) => s.project.composition)
  const [text, setText] = useState(() => {
    try {
      const draft = JSON.parse(localStorage.getItem('calligraphy-input') || 'null')
      if (draft?.projectText === (projectText ?? null) && typeof draft.text === 'string')
        return draft.text as string
    } catch {
      /* A blocked browser store should not prevent editing. */
    }
    return projectText ?? '明月松间照\n清泉石上流'
  })
  const previousText = useRef(projectText)
  const [layout, setLayout] = useState<BatchLayout>('vertical-rtl')
  const [columns, setColumns] = useState(5)
  const [size, setSize] = useState(160)
  const [gap, setGap] = useState(12)
  const [margin, setMargin] = useState(64)
  const [style, setStyle] = useState('行书')
  const [source, setSource] = useState<CandidateSource>('fonts')
  const [policy, setPolicy] = useState<CandidatePolicy>(DEFAULT_POLICY)
  const [packNames, setPackNames] = useState<string[]>([])
  useEffect(() => {
    if (active) void installedPacks().then((packs) => setPackNames(packs.filter((pack) => pack.enabled).map((pack) => pack.name))).catch(() => undefined)
  }, [active])
  const [punctuation, setPunctuation] = useState(false)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const compose = useEditorStore((s) => s.compose)
  const setComposition = useEditorStore((s) => s.setComposition)
  useEffect(() => {
    if (previousText.current !== projectText) setText(projectText ?? '')
    previousText.current = projectText
  }, [projectText])
  useEffect(() => {
    try {
      localStorage.setItem(
        'calligraphy-input',
        JSON.stringify({ projectText: projectText ?? null, text }),
      )
    } catch {
      setStatus('输入文字未能保存到本机，请及时生成并下载项目。')
    }
  }, [text, projectText])
  useEffect(() => {
    setLayout(settings?.layout ?? DEFAULT_SETTINGS.layout)
    setColumns(settings?.columns ?? DEFAULT_SETTINGS.columns)
    setSize(settings?.size ?? DEFAULT_SETTINGS.size)
    setGap(settings?.gap ?? DEFAULT_SETTINGS.gap)
    setMargin(settings?.margin ?? DEFAULT_SETTINGS.margin)
    setPunctuation(settings?.punctuation ?? DEFAULT_SETTINGS.punctuation)
    setStyle(settings?.style ?? DEFAULT_SETTINGS.style)
    setSource(settings?.source ?? DEFAULT_SETTINGS.source)
    setPolicy(settings?.policy || DEFAULT_POLICY)
  }, [settings])
  const count = textLines(text, punctuation).flat().length
  const japanese = policy.writing_tradition === 'Japanese'
  const settingsFor = (nextPolicy: CandidatePolicy, nextSource: CandidateSource) =>
    ({ layout, columns, size, gap, margin, punctuation, style, source: nextSource, policy: nextPolicy })

  function saveFontPreference(nextPolicy: CandidatePolicy, nextSource = source) {
    setPolicy(nextPolicy)
    setSource(nextSource)
    const next = settingsFor(nextPolicy, nextSource)
    if (validLayoutDimensions(next)) setComposition(next)
    else {
      setComposition({ ...(settings ?? DEFAULT_SETTINGS), policy: nextPolicy, source: nextSource })
      setStatus('字体偏好已保存，排版数值已恢复为上次的有效设置。')
    }
  }
  function updatePolicy(next: CandidatePolicy) {
    if (next.writing_tradition !== policy.writing_tradition) saveFontPreference(next, 'fonts')
    else setPolicy(next)
  }

  const create = async () => {
    const previousProject = useEditorStore.getState().project
    setLoading(true)
    setStatus('正在加载字库…')
    try {
      const plan = layoutText(text, {
        layout,
        columns,
        size,
        gap,
        margin,
        punctuation,
      })
      const found = await resolveCharacters(
        plan.positions.map((p) => p.character),
        async (character) => {
          // Initial composition fetches a small page; further variants load only on selection.
          const page = await initialCandidates(character, source, (japanese || policy.dataset) ? '' : style, 4, undefined, { ...policy, vertical: layout === 'vertical-rtl' })
          return page.items[0]
        },
        (done, total) => setStatus(`正在加载字库 ${done}/${total} 个不同字…`),
      )
      const resolved = new Map<string, Glyph>()
      found.forEach((glyph, character) => {
        if (glyph) resolved.set(character, glyph)
      })
      const missing = [
        ...new Set(
          plan.positions.filter((p) => !resolved.has(p.character)).map((p) => p.character),
        ),
      ]
      const missingHint = japanese ? '可选择其他字体，或启用缺字补字。' : '可换书体或字形来源。'
      if (!resolved.size)
        throw new Error(`未找到可用字形：${missing.join('、')}。${missingHint}`)
      const glyphs = plan.positions.flatMap((p) => {
        const glyph = resolved.get(p.character)
        return glyph ? [placeGlyph(glyph, p.x, p.y, plan.size)] : []
      })
      if (useEditorStore.getState().project !== previousProject)
        throw new Error('作品已更改，请重新生成以应用这段文字。')
      compose(
        glyphs,
        {
          width: Math.max(100, plan.width),
          height: Math.max(100, plan.height),
          background: previousProject.canvas.background,
        },
        text,
        settingsFor(policy, source),
      )
      const fallbackFonts = [...new Set(glyphs.filter((g) => policy.font_id &&
        g.metadata?.font_id !== policy.font_id).map((g) => g.source.work).filter(Boolean))]
      const fallbackMessage = [
        glyphs.some((g) => g.source.source_role === 'coverage-fallback') ? '部分汉字使用日文覆盖字体。' : '',
        fallbackFonts.length ? `缺字由 ${fallbackFonts.join('、')} 补字。` : '',
      ].join('')
      setStatus(
        missing.length
          ? `已排入 ${glyphs.length}/${count} 字，缺字「${missing.join('、')}」已留空位。${missingHint}${fallbackMessage}`
          : `已排入 ${glyphs.length} 字。${fallbackMessage}${plan.fit < 1 ? '纸面已等比缩小；可调整每行或列字数改善阅读。' : ''}`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '集字失败，请重试')
    } finally {
      setLoading(false)
    }
  }
  return (
    <fieldset className="composer" disabled={loading} aria-label="集字排版">
      <div className="section-title">
        <label htmlFor="compose-text">集字内容</label>
        <span>{count} / 1000 字</span>
      </div>
      <textarea
        id="compose-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="输入文字，换行分句"
      />
      <SourcePolicyControls policy={policy} onChange={updatePolicy} />
      <div className="field-grid">
        {japanese ? <JapaneseFontSelect policy={policy} onChange={(next) => saveFontPreference(next, 'fonts')} /> : <label>
          书体
          <select aria-label="书体" value={style} disabled={source === 'private' || !!policy.dataset} onChange={(e) => setStyle(e.target.value)}>
            <option>楷书</option>
            <option>行书</option>
            <option>草书</option>
          </select>
        </label>}
        <label>
          来源
          <select
            aria-label="字形来源"
            value={source === 'all' && policy.dataset ? 'pack:' + policy.dataset : source}
            onChange={(e) => {
              const value = e.target.value
              const nextSource = value.startsWith('pack:') ? 'all' : value as CandidateSource
              const next = { ...policy, dataset: value.startsWith('pack:') ? value.slice(5) : undefined }
              if (japanese) saveFontPreference({ ...next, font_id: undefined, allow_font_fallback: undefined }, nextSource)
              else { setSource(nextSource); setPolicy(next) }
            }}
          >
            <option value="fonts">字体</option>
            <option value="original">原帖</option>
            <option value="all">字体与原帖</option>
            <option value="fallback">结构替补</option>
            <option value="private">个人字库</option>
            {policy.dataset && !packNames.includes(policy.dataset) && <option value={'pack:' + policy.dataset}>{policy.dataset}（未启用）</option>}
            {packNames.map((name) => <option key={name} value={'pack:' + name}>{name}</option>)}
          </select>
        </label>
      </div>
      {japanese && (source === 'fonts' || (source === 'all' && !policy.dataset)) &&
        <JapaneseFontFallback policy={policy} onChange={(next) => saveFontPreference(next)} />}
      <div className="segmented" aria-label="排版方向">
        {(
          [
            ['vertical-rtl', '竖排'],
            ['horizontal-ltr', '横排'],
            ['grid', '方格'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} aria-pressed={layout === value} onClick={() => setLayout(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="field-grid">
        <label>
          {layout === 'vertical-rtl' ? '每列最多' : '每行最多'}
          <div className="unit-input">
            <input
              aria-label="每行或列字数"
              type="number"
              min={1}
              max={30}
              step={1}
              value={columns}
              onChange={(e) => setColumns(Math.floor(Number(e.target.value)))}
            />
            <span>字</span>
          </div>
        </label>
        <label>
          字格大小
          <div className="unit-input">
            <input
              aria-label="字格大小"
              type="number"
              min={40}
              max={400}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
            <span>px</span>
          </div>
        </label>
      </div>
      <details className="advanced">
        <summary>间距与留白</summary>
        <div className="field-grid">
          <label>
            字距
            <input
              type="number"
              min={0}
              max={160}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
            />
          </label>
          <label>
            页边距
            <input
              type="number"
              min={0}
              max={300}
              value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={punctuation}
            onChange={(e) => setPunctuation(e.target.checked)}
          />
          保留标点
        </label>
      </details>
      <Button
        className="compose-button"
        onClick={create}
        disabled={loading || !count || count > 1000}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
        {loading ? '正在集字…' : '生成作品'}
      </Button>
      <p className="field-hint">自动适配纸面尺寸。重新生成会替换当前排版，可撤销。</p>
      {status && (
        <p className="feedback" role="status">
          {status}
        </p>
      )}
    </fieldset>
  )
}
