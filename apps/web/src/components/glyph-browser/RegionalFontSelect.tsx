import { useEffect, useState } from 'react'
import { fontCatalog, type FontEntry } from '../../api/fonts'
import { selectRegionalFont, type CandidatePolicy } from '../../lib/candidatePolicy'

export function RegionalFontSelect({ policy, onChange }: {
  policy: CandidatePolicy
  onChange: (policy: CandidatePolicy) => void
}) {
  const [fonts, setFonts] = useState<FontEntry[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void fontCatalog().then((entries) => {
      if (active) setFonts(entries)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])
  const regionalFonts = fonts.filter((font) => font.writing_tradition === policy.writing_tradition)
  const historical = regionalFonts.filter((font) => font.variant_type === 'hentaigana')
  const coverage = regionalFonts.filter((font) => font.source_role === 'coverage-fallback')
  const ordinary = regionalFonts.filter((font) => !historical.includes(font) && !coverage.includes(font))
  return <label>字体
    <select aria-label="字体" value={policy.font_id || ''} disabled={!regionalFonts.length}
      onChange={(e) => onChange(selectRegionalFont(policy, e.target.value))}>
      <option value="">自动选择</option>
      {policy.font_id && !regionalFonts.some((font) => font.id === policy.font_id) &&
        <option value={policy.font_id} disabled>{policy.font_id}（字库不可用）</option>}
      {ordinary.map((font) => <option key={font.id} value={font.id}>{font.family}</option>)}
      {historical.length > 0 && <optgroup label="历史假名">
        {historical.map((font) => <option key={font.id} value={font.id}>{font.family}（历史假名）</option>)}
      </optgroup>}
      {coverage.length > 0 && <optgroup label="覆盖补字">
        {coverage.map((font) => <option key={font.id} value={font.id}>{font.family}（覆盖补字）</option>)}
      </optgroup>}
    </select>
    {failed && <span className="field-hint">内置字体清单加载失败，请重新打开工作台。</span>}
  </label>
}

export function RegionalFontFallback({ policy, onChange }: {
  policy: CandidatePolicy
  onChange: (policy: CandidatePolicy) => void
}) {
  return <label className="check-field">
    <input type="checkbox" checked={policy.allow_font_fallback === true}
      onChange={(e) => onChange({ ...policy, allow_font_fallback: e.target.checked })} />
    {policy.writing_tradition === 'Korean' ? '缺字时允许其他韩文字体补字' : '缺字时允许其他日文字体补字'}
  </label>
}
