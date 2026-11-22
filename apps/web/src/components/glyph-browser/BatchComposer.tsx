import { uiText } from "../../i18n"
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { initialCandidates, resolveCharacters, type CandidateSource } from '../../api/candidates'
import { RegionalFontFallback, RegionalFontSelect } from './RegionalFontSelect'
import { SourcePolicyControls } from './SourcePolicyControls'
import { DEFAULT_TYPOGRAPHY, TypographyControls } from './TypographyControls'
import { usesRegionalFonts, DEFAULT_POLICY, type CandidatePolicy } from '../../lib/candidatePolicy'
import { layoutText, placeGlyph, textLines, validLayoutDimensions } from '../../lib/composition'
import { useEditorStore } from '../../stores/editor'
import type { BatchLayout, CompositionSettings, Glyph, TextLanguage } from '../../types'
import { Button } from '../ui'
import { installedPacks } from '../../lib/privateLibrary'
import type { AdvancedTypography } from '../../types/typesetting'
import { segmentText } from '../../lib/textLayout'
import { composeTypeset } from '../../lib/typesetComposition'
import type { GlyphInstance } from '../../types'
import { hasEditorialRelations, isLacuna, restorationCandidates, restorationDecision,
  type RestorationRecord, type RestorationSlot } from '../../lib/glyphRestoration'
import { RestorationPanel } from './RestorationPanel'

const NEW_POLICY = { ...DEFAULT_POLICY, smart_mix: true }

const DEFAULT_SETTINGS: CompositionSettings = {
  layout: 'vertical-rtl', columns: 5, size: 160, gap: 12, margin: 64,
  punctuation: false, style: '行书', source: 'fonts', policy: NEW_POLICY,
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
  const [policy, setPolicy] = useState<CandidatePolicy>(NEW_POLICY)
  const textInput = useRef<HTMLTextAreaElement>(null)
  const [typography, setTypography] = useState<AdvancedTypography | undefined>(settings?.typography)
  useEffect(() => setTypography(settings?.typography), [settings?.typography])
  const [packNames, setPackNames] = useState<string[]>([])
  useEffect(() => {
    if (active) void installedPacks().then((packs) => setPackNames(packs.filter((pack) => pack.enabled).map((pack) => pack.name))).catch(() => undefined)
  }, [active])
  const [punctuation, setPunctuation] = useState(false)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const compose = useEditorStore((s) => s.compose)
  const selectedGlyph = useEditorStore((s) => s.project.glyphs.find((g) => g.id === s.selectedId))
  const pin = text === projectText && selectedGlyph?.textRange && segmentText(selectedGlyph.character).length === 1
    ? { ...selectedGlyph.textRange, glyphId: typeof selectedGlyph.metadata?.font_id === 'string'
        ? selectedGlyph.metadata.font_id : selectedGlyph.glyph_id }
    : undefined
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
      setStatus(uiText("输入文字未能保存到本机，请及时生成并下载项目。"))
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
    setPolicy(settings?.policy || (settings ? DEFAULT_POLICY : NEW_POLICY))
  }, [settings])
  const textLanguage = settings?.textLanguage || 'und'
  const count = typography ? segmentText(text).length : textLines(text, punctuation).flat().length
  const regional = usesRegionalFonts(policy.writing_tradition)
  const settingsFor = (nextPolicy: CandidatePolicy, nextSource: CandidateSource) =>
    ({ layout, columns, size, gap, margin, punctuation, style, source: nextSource, policy: nextPolicy, textLanguage })

  function saveFontPreference(nextPolicy: CandidatePolicy, nextSource = source) {
    setPolicy(nextPolicy)
    setSource(nextSource)
    const next = settingsFor(nextPolicy, nextSource)
    if (validLayoutDimensions(next)) setComposition({ ...next, typography: settings?.typography,
      shapedRuns: settings?.shapedRuns, flowCosts: settings?.flowCosts })
    else {
      setComposition({ ...(settings ?? DEFAULT_SETTINGS), policy: nextPolicy, source: nextSource })
      setStatus(uiText("字体偏好已保存，排版数值已恢复为上次的有效设置。"))
    }
  }
  function updatePolicy(next: CandidatePolicy) {
    if (next.writing_tradition !== policy.writing_tradition || next.smart_mix !== policy.smart_mix) saveFontPreference(next, 'fonts')
    else setPolicy(next)
  }

  const restore = async (glyphs: GlyphInstance[], slots: RestorationSlot[], previous: ReturnType<typeof useEditorStore.getState>['project']) => {
    const past = previous.text === text ? previous.restorations || [] : []
    const anchor = glyphs.find((glyph) => glyph.provenance.type === 'original')?.source ||
      { dataset: '', work: policy.work, calligrapher: policy.designer, style }
    const requests = new Map(slots.map((slot) => [slot.start, slot]))
    for (const glyph of glyphs) {
      if (!glyph.textRange) continue
      const tradition = glyph.source.writing_tradition
      if (tradition !== 'Chinese' && tradition !== 'Japanese' && tradition !== 'Korean') continue
      const slot: RestorationSlot = { ...glyph.textRange, text: glyph.character, x: glyph.transform.x, y: glyph.transform.y,
        size: Math.max(glyph.asset.width * glyph.transform.scaleX, glyph.asset.height * glyph.transform.scaleY), tradition }
      if (hasEditorialRelations(text, slot) || past.some((item) => item.start === slot.start)) requests.set(slot.start, slot)
    }
    const results: RestorationRecord[] = []
    const recovered: GlyphInstance[] = []
    const replaced = new Set<number>()
    const candidatesByText = new Map<string, Promise<Awaited<ReturnType<typeof restorationCandidates>>>>()
    for (const slot of requests.values()) {
      const prior = past.find((item) => item.start === slot.start && item.end === slot.end)
      const last = prior?.decisions.at(-1)
      const saved = last?.confirmed && previous.glyphs.find((glyph) => glyph.glyph_id === last.glyphId && glyph.textRange?.start === slot.start)
      if (saved) {
        recovered.push({ ...placeGlyph(saved, slot.x, slot.y, slot.size), glyph_id: saved.glyph_id,
          textRange: { start: slot.start, end: slot.end } })
        replaced.add(slot.start)
      }
      const decisions = [...(prior?.decisions || [])]
      if (!saved && slots.some((item) => item.start === slot.start) && !isLacuna(slot.text)) {
        const key = JSON.stringify([slot.text, slot.tradition])
        let pending = candidatesByText.get(key)
        if (!pending) {
          pending = restorationCandidates(text, slot, { ...policy, vertical: layout === 'vertical-rtl' }, anchor)
          candidatesByText.set(key, pending)
        }
        const match = (await pending).find((candidate) => candidate.automatic)
        if (match) {
          const decision = restorationDecision(match, false)
          if (last?.glyphId !== decision.glyphId) decisions.push(decision)
          recovered.push({ ...placeGlyph(match.glyph, slot.x, slot.y, slot.size),
            textRange: { start: slot.start, end: slot.end } })
          replaced.add(slot.start)
        }
      }
      results.push({ ...slot, decisions })
    }
    const composed = [...glyphs.filter((glyph) => !replaced.has(glyph.textRange?.start ?? -1)), ...recovered]
      .sort((a,b) => (a.textRange?.start ?? 0) - (b.textRange?.start ?? 0))
    return { glyphs: composed, records: results, missing: slots.filter((slot) => !replaced.has(slot.start)) }
  }

  const create = async () => {
    const previousProject = useEditorStore.getState().project
    setLoading(true)
    setStatus(uiText("正在加载字库…"))
    try {
      const mixed = policy.smart_mix && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
      const advanced = typography || (mixed ? { ...DEFAULT_TYPOGRAPHY, mixed: true } : undefined)
      if (advanced) {
        const base = settingsFor(policy, source)
        if (!validLayoutDimensions(base)) throw new Error(uiText('请填写有效的排版数值'))
        const tradition = policy.writing_tradition === 'Chinese' || policy.writing_tradition === 'Korean'
          ? policy.writing_tradition : policy.writing_tradition === 'Japanese' ? 'Japanese' : 'Chinese'
        const result = await composeTypeset(text, {
          ...advanced, mixed: advanced.mixed || Boolean(mixed), layout, measure: columns, size, gap, margin, style, source, policy,
          tradition, language: textLanguage,
        })
        const restored = await restore(result.glyphs, result.missingPositions, previousProject)
        if (useEditorStore.getState().project !== previousProject)
          throw new Error(uiText('作品已更改，请重新生成以应用这段文字。'))
        const missing = [...new Set(restored.missing.map((unit) => unit.text))]
        const missingHint = uiText('可选择其他字体，或启用缺字补字。')
        compose(restored.glyphs, {
          width: result.width, height: result.height, background: previousProject.canvas.background,
        }, text, { ...base, typography: advanced, shapedRuns: result.runs, flowCosts: result.flowCosts }, restored.records)
        setStatus(missing.length
          ? uiText('已排入 {{v0}}/{{v1}} 字，缺字「{{v2}}」已留空位。{{v3}}{{v4}}', {
            v0: restored.glyphs.length, v1: count, v2: missing.join('、'), v3: missingHint, v4: '',
          })
          : uiText('已排入 {{v0}} 字。{{v1}}{{v2}}', { v0: restored.glyphs.length, v1: '', v2: '' }))
        return
      }
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
          if (isLacuna(character)) return undefined
          // Initial composition fetches a small page; further variants load only on selection.
          const page = await initialCandidates(character, source, (regional || policy.dataset) ? '' : style, 4, undefined, { ...policy, vertical: layout === 'vertical-rtl' })
          return page.items[0]
        },
        (done, total) => setStatus(uiText("正在加载字库 {{v0}}/{{v1}} 个不同字…", { v0: done, v1: total })),
      )
      const resolved = new Map<string, Glyph>()
      found.forEach((glyph, character) => {
        if (glyph) resolved.set(character, glyph)
      })
      const missingHint = regional ? uiText("可选择其他字体，或启用缺字补字。") : uiText("可换书体或字形来源。")
      let offset = 0
      const slots: RestorationSlot[] = []
      const tradition = policy.writing_tradition === 'Korean' || policy.writing_tradition === 'Japanese'
        ? policy.writing_tradition : 'Chinese'
      const initial = plan.positions.flatMap((p) => {
        const start = text.indexOf(p.character, offset)
        const end = start + p.character.length
        if (start >= 0) offset = end
        const glyph = resolved.get(p.character)
        const range = start >= 0 ? { start, end } : undefined
        if (!glyph && range) slots.push({ ...range, text: p.character, x: p.x, y: p.y, size: plan.size, tradition })
        return glyph ? [{ ...placeGlyph(glyph, p.x, p.y, plan.size), textRange: range }] : []
      })
      const { glyphs, records, missing: pending } = await restore(initial, slots, previousProject)
      const missing = [...new Set(pending.map((slot) => slot.text))]
      if (useEditorStore.getState().project !== previousProject)
        throw new Error(uiText("作品已更改，请重新生成以应用这段文字。"))
      compose(
        glyphs,
        {
          width: Math.max(100, plan.width),
          height: Math.max(100, plan.height),
          background: previousProject.canvas.background,
        },
        text,
        settingsFor(policy, source),
        records,
      )
      const fallbackFonts = [...new Set(glyphs.filter((g) => policy.font_id &&
        g.metadata?.font_id !== policy.font_id).map((g) => g.source.work).filter(Boolean))]
      const fallbackMessage = [
        glyphs.some((g) => g.source.source_role === 'coverage-fallback')
          ? (policy.writing_tradition === 'Korean' ? uiText("部分字使用韩文覆盖字体。") : uiText("部分汉字使用日文覆盖字体。")) : '',
        fallbackFonts.length ? uiText("缺字由 {{v0}} 补字。", { v0: fallbackFonts.join('、') }) : '',
      ].join('')
      setStatus(
        missing.length
          ? uiText("已排入 {{v0}}/{{v1}} 字，缺字「{{v2}}」已留空位。{{v3}}{{v4}}", { v0: glyphs.length, v1: count, v2: missing.join('、'), v3: missingHint, v4: fallbackMessage })
          : uiText("已排入 {{v0}} 字。{{v1}}{{v2}}", { v0: glyphs.length, v1: fallbackMessage, v2: plan.fit < 1 ? uiText("纸面已等比缩小；可调整每行或列字数改善阅读。") : '' }),
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : uiText("集字失败，请重试"))
    } finally {
      setLoading(false)
    }
  }
  return (
    <fieldset className="composer" disabled={loading} aria-label={uiText("集字排版")}>
      <div className="section-title">
        <label htmlFor="compose-text">{uiText("集字内容")}</label>
        <span>{count} {uiText("/ 1000 字")}</span>
      </div>
      <textarea
        id="compose-text"
        ref={textInput}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (typography?.tcy.length || typography?.spans?.length || typography?.flow?.pins.length)
            setTypography({ ...typography, tcy: [], spans: undefined,
              flow: typography.flow && { ...typography.flow, pins: [] } })
        }}
        rows={5}
        placeholder={uiText("输入文字，换行分句")}
      />
      <label>{uiText("文本语言")}
        <select value={textLanguage} aria-label={uiText("文本语言")} onChange={(event) => {
          const selected = event.target.value as TextLanguage
          const current = settingsFor(policy, source)
          setComposition({ ...(validLayoutDimensions(current) ? current : settings ?? DEFAULT_SETTINGS), textLanguage: selected })
        }}>
          <option value="und">{uiText("自动或混合")}</option>
          <option value="zh" lang="zh">{uiText("中文")}</option><option value="ja" lang="ja">{uiText("日本語")}</option>
          <option value="ko" lang="ko">{uiText("한국어")}</option><option value="en" lang="en">English</option>
        </select>
      </label>
      <SourcePolicyControls policy={policy} onChange={updatePolicy} />
      <TypographyControls value={typography} onChange={setTypography} input={textInput} vertical={layout === 'vertical-rtl'} pin={pin} />
      <div className="field-grid">
        {regional ? <RegionalFontSelect policy={policy} onChange={(next) => saveFontPreference(next, 'fonts')} /> : <label>
          {uiText("书体")}
          <select aria-label={uiText("书体")} value={style} disabled={source === 'private' || !!policy.dataset} onChange={(e) => setStyle(e.target.value)}>
            <option value="楷书">{uiText("楷书")}</option>
            <option value="行书">{uiText("行书")}</option>
            <option value="草书">{uiText("草书")}</option>
          </select>
        </label>}
        <label>
          {uiText("来源")}
          <select
            aria-label={uiText("字形来源")}
            value={source === 'all' && policy.dataset ? 'pack:' + policy.dataset : source}
            onChange={(e) => {
              const value = e.target.value
              const nextSource = value.startsWith('pack:') ? 'all' : value as CandidateSource
              const next = { ...policy, dataset: value.startsWith('pack:') ? value.slice(5) : undefined }
              if (regional) saveFontPreference({ ...next, font_id: undefined, allow_font_fallback: undefined }, nextSource)
              else { setSource(nextSource); setPolicy(next) }
            }}
          >
            <option value="fonts">{uiText("字体")}</option>
            <option value="original">{uiText("原帖")}</option>
            <option value="all">{uiText("字体与原帖")}</option>
            <option value="fallback">{uiText("结构替补")}</option>
            <option value="private">{uiText("个人字库")}</option>
            {policy.dataset && !packNames.includes(policy.dataset) && <option value={'pack:' + policy.dataset}>{policy.dataset}{uiText("（未启用）")}</option>}
            {packNames.map((name) => <option key={name} value={'pack:' + name}>{name}</option>)}
          </select>
        </label>
      </div>
      {regional && (source === 'fonts' || (source === 'all' && !policy.dataset)) &&
        <RegionalFontFallback policy={policy} onChange={(next) => saveFontPreference(next)} />}
      <div className="segmented" aria-label={uiText("排版方向")}>
        {(
          [
            ['vertical-rtl', uiText("竖排")],
            ['horizontal-ltr', uiText("横排")],
            ['grid', uiText("方格")],
          ] as const
        ).map(([value, label]) => (
          <button key={value} aria-pressed={layout === value} onClick={() => setLayout(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="field-grid">
        <label>
          {layout === 'vertical-rtl' ? uiText("每列最多") : uiText("每行最多")}
          <div className="unit-input">
            <input
              aria-label={uiText("每行或列字数")}
              type="number"
              min={1}
              max={30}
              step={1}
              value={columns}
              onChange={(e) => setColumns(Math.floor(Number(e.target.value)))}
            />
            <span>{uiText("字")}</span>
          </div>
        </label>
        <label>
          {uiText("字格大小")}
          <div className="unit-input">
            <input
              aria-label={uiText("字格大小")}
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
        <summary>{uiText("间距与留白")}</summary>
        <div className="field-grid">
          <label>
            {uiText("字距")}
            <input
              type="number"
              min={0}
              max={160}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
            />
          </label>
          <label>
            {uiText("页边距")}
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
          {uiText("保留标点")}
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
        {loading ? uiText("正在集字…") : uiText("生成作品")}
      </Button>
      <p className="field-hint">{uiText("自动适配纸面尺寸。重新生成会替换当前排版，可撤销。")}</p>
      {status && (
        <p className="feedback" role="status">
          {status}
        </p>
      )}
      <RestorationPanel />
    </fieldset>
  )
}
