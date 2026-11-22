import type { RefObject } from 'react'
import type { AdvancedTypography } from '../../types/typesetting'
import { uiText } from '../../i18n'

export const DEFAULT_TYPOGRAPHY: AdvancedTypography = {
  mixed: false, kinsoku: true, compressPunctuation: false,
  automaticTcy: true, tcy: [], discretionary: false,
}

export function TypographyControls({ value, onChange, input, vertical }: {
  value: AdvancedTypography | undefined
  onChange: (options: AdvancedTypography | undefined) => void
  input: RefObject<HTMLTextAreaElement | null>
  vertical: boolean
}) {
  const toggles: Array<['mixed' | 'kinsoku' | 'compressPunctuation' | 'discretionary' | 'automaticTcy', string]> = [
    ['mixed', '混合文字传统'],
    ['kinsoku', '遵守断行禁则'],
    ['compressPunctuation', '压缩标点间距'],
    ['discretionary', '启用字体的可选连字'],
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
      {toggles.map(([option, label]) => <label key={option} className="check-field">
        <input type="checkbox" checked={value[option]}
          onChange={(event) => onChange({ ...value, [option]: event.target.checked })} />
        {uiText(label)}
      </label>)}
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
