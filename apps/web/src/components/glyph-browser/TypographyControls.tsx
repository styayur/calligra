import { useState, type RefObject } from 'react'
import type { AdvancedTypography, GlyphPin, TextSpan } from '../../types/typesetting'
import { uiText } from '../../i18n'
import { segmentText } from '../../lib/textLayout'

export const DEFAULT_TYPOGRAPHY: AdvancedTypography = {
  mixed: false, kinsoku: true, compressPunctuation: false,
  automaticTcy: true, tcy: [], discretionary: false,
}

export function TypographyControls({ value, onChange, input, vertical, pin }: {
  value: AdvancedTypography | undefined
  onChange: (options: AdvancedTypography | undefined) => void
  input: RefObject<HTMLTextAreaElement | null>
  vertical: boolean
  pin?: GlyphPin
}) {
  const [spanLanguage, setSpanLanguage] = useState<'zh' | 'ja' | 'ko' | 'en'>('ja')
  const [rangeError, setRangeError] = useState(false)
  const applyLanguage = () => {
    const field = input.current
    if (!field || !value) return
    const { selectionStart: start, selectionEnd: end } = field
    const boundaries = new Set([0, ...segmentText(field.value).map((cluster) => cluster.end)])
    const invalid = start === end || !boundaries.has(start) || !boundaries.has(end)
    setRangeError(invalid)
    if (invalid) return
    const traditions: Record<typeof spanLanguage, TextSpan['tradition']> = {
      zh: 'Chinese', ja: 'Japanese', ko: 'Korean', en: undefined,
    }
    const spans = (value.spans || []).filter((item) => item.end <= start || item.start >= end)
    const span = { start, end, language: spanLanguage, tradition: traditions[spanLanguage] }
    onChange({ ...value, spans: [...spans, span] })
  }
  const toggles: Array<['mixed' | 'kinsoku' | 'compressPunctuation' | 'discretionary' | 'automaticTcy' | 'connectedKana', string]> = [
    ['mixed', '混合文字传统'],
    ['kinsoku', '遵守断行禁则'],
    ['compressPunctuation', '压缩标点间距'],
    ['discretionary', '启用字体的可选连字'],
    ['connectedKana', '使用已校对的原帖连绵假名（个人字库或全部来源）'],
  ]
  if (vertical) toggles.push(['automaticTcy', '自动纵中横'])
  return <details className="advanced">
    <summary>{uiText('高级排版')}</summary>
    <label className="check-field">
      <input type="checkbox" checked={Boolean(value)} onChange={(event) =>
        onChange(event.target.checked ? DEFAULT_TYPOGRAPHY : undefined)} />
      {uiText('启用 OpenType 排版')}
    </label>
    {value && <>
      <label>
        {uiText('字形排列')}
        <select aria-label={uiText('字形排列')} value={value.flow?.mode || ''}
          onChange={(event) => onChange({ ...value,
            flow: event.target.value ? { mode: event.target.value === 'fluent' ? 'fluent' : 'natural',
              intensity: value.flow?.intensity ?? .5, pins: value.flow?.pins ?? [] } : undefined,
          })}>
          <option value="">{uiText('标准 OpenType')}</option>
          <option value="natural">{uiText('自然')}</option>
          <option value="fluent">{uiText('行草协调（实验性）')}</option>
        </select>
      </label>
      {value.flow && <fieldset>
        <label>
          {uiText('调整强度')}
          <input type="range" min="0" max="1" step=".05" value={value.flow.intensity}
            onChange={(event) => onChange({ ...value, flow: { ...value.flow!, intensity: Number(event.target.value) } })} />
        </label>
        {pin && <button type="button" onClick={() => onChange({ ...value, flow: {
          ...value.flow!, pins: [...value.flow!.pins.filter((entry) => entry.start !== pin.start), pin],
        } })}>{uiText('固定所选字形')}</button>}
        {value.flow.pins.length > 0 && <button type="button"
          onClick={() => onChange({ ...value, flow: { ...value.flow!, pins: [] } })}>
          {uiText('清除固定字形')} ({value.flow.pins.length})
        </button>}
        <p className="field-hint">{uiText('协调依据字形轮廓估计，保留原有笔画。规整字格可关闭 OpenType 排版。')}</p>
      </fieldset>}
      {toggles.map(([option, label]) => <label key={option} className="check-field">
        <input type="checkbox" checked={Boolean(value[option])}
          onChange={(event) => onChange({ ...value, [option]: event.target.checked })} />
        {uiText(label)}
      </label>)}
      {value.mixed && <>
        <label>
          {uiText('所选文字的语言')}
          <select aria-label={uiText('所选文字的语言')} value={spanLanguage}
            onChange={(event) => setSpanLanguage(event.target.value as typeof spanLanguage)}>
            <option value="zh">中文</option><option value="ja">日本語</option>
            <option value="ko">한국어</option><option value="en">English</option>
          </select>
        </label>
        <button type="button" onClick={applyLanguage}>{uiText('为所选文字指定语言')}</button>
        {value.spans?.length ? <button type="button"
          onClick={() => onChange({ ...value, spans: value.spans!.slice(0, -1) })}>{uiText('撤销上一个语言范围')}</button> : null}
        {rangeError && <p role="status">{uiText('请选中一个或多个完整文字单元。')}</p>}
      </>}
      {vertical && <>
        <p className="field-hint">{uiText('在正文中选中最多八个拉丁字符或数字，再指定纵中横。')}</p>
        <button type="button" onClick={() => {
          const field = input.current
          if (!field) return
          const start = field.selectionStart
          const end = field.selectionEnd
          if (!/^[A-Za-z0-9.+%/-]{1,8}$/.test(field.value.slice(start, end))) return
          onChange({ ...value, tcy: [...value.tcy.filter((item) => item.end <= start || item.start >= end), { start, end }] })
        }}>{uiText('将所选文字设为纵中横')}</button>
        <button type="button" disabled={!value.tcy.length}
          onClick={() => onChange({ ...value, tcy: value.tcy.slice(0, -1) })}>{uiText('撤销上一个纵中横范围')}</button>
        {value.tcy.length > 0 && <output>{value.tcy.map(({ start, end }) => input.current?.value.slice(start, end)).join(' · ')}</output>}
      </>}
    </>}
  </details>
}
