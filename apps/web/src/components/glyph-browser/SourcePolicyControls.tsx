import { uiText } from "../../i18n"
import { traditionLocale, type CandidatePolicy, type ExplorationMode } from '../../lib/candidatePolicy'

export function SourcePolicyControls({ policy, onChange }: { policy: CandidatePolicy; onChange: (value: CandidatePolicy) => void }) {
  const update = (key: keyof CandidatePolicy, value: string) => onChange({ ...policy, [key]: value || undefined })
  return <div className="source-policy">
    <label>{uiText('集字模式')}
      <select aria-label={uiText('集字模式')} value={policy.smart_mix ? 'mixed' : policy.writing_tradition || 'Chinese'}
        onChange={(event) => {
          const smart_mix = event.target.value === 'mixed'
          const writing_tradition = smart_mix ? 'Chinese' : event.target.value
          onChange({ writing_tradition, smart_mix, locale: traditionLocale(writing_tradition), mode: 'strict',
            commercial_only: policy.commercial_only })
        }}>
        <option value="mixed">{uiText('智能混排')}</option>
        <option value="Chinese">{uiText('中国书法')}</option>
        <option value="Japanese">{uiText('日本書道')}</option>
        <option value="Korean">{uiText('한국 서예')}</option>
      </select>
    </label>
    <details className="advanced">
      <summary>{uiText("字形与跨传统探索 / Variants & exploration")}</summary>
      <label>{uiText("文字 / Script")}
        <select aria-label={uiText("Script")} value={policy.script || ''} onChange={(e) => update('script',e.target.value)}>
          <option value="">{uiText("全部 / All scripts")}</option><option value="Han">{uiText("漢字 / Han · Kanji")}</option>
          {policy.writing_tradition === 'Korean' && <><option value="Hangul">{uiText("한글 / Hangul")}</option><option value="Latin">{uiText("拉丁 / Latin")}</option></>}
          {policy.writing_tradition === 'Japanese' && <><option value="Hiragana">{uiText("ひらがな / Hiragana")}</option><option value="Katakana">{uiText("カタカナ / Katakana")}</option></>}
        </select>
      </label>
      <label>{uiText("语言 / Language")}<select aria-label={uiText("Language")} value={policy.language || ''} onChange={(e) => update('language',e.target.value)}><option value="">{uiText("未限定 / Any or unknown")}</option><option value="zh">{uiText("中文 / zh")}</option><option value="ja">{uiText("日本語 / ja")}</option><option value="ko">{uiText("한국어 / ko")}</option></select></label>
      <label>{uiText("选择规则 / Candidate mode")}
        <select aria-label={uiText("Candidate mode")} value={policy.mode || 'strict'} onChange={(e) => onChange({ ...policy, mode: e.target.value as ExplorationMode })}>
          <option value="strict">{uiText("严格传统 / Strict tradition")}</option><option value="related">{uiText("相关字形 / Related variants")}</option><option value="cross-tradition">{uiText("跨传统探索 / Cross-tradition exploration")}</option>
        </select>
      </label>
      <label>{uiText("字形变体 / Variant")}
        <select aria-label={uiText("Variant type")} value={policy.variant_type || ''} onChange={(e) => update('variant_type',e.target.value)}>
          <option value="">{uiText("默认 / Default variants")}</option>
          <option value="regional">{uiText("地区字形 / Regional")}</option>
          <option value="historical">{uiText("くずし字 / Historical glyphs")}</option>
          <option value="hentaigana">{uiText("変体仮名 / Hentaigana")}</option>
          <option value="shinjitai">{uiText("新字体 / Shinjitai")}</option><option value="kyujitai">{uiText("旧字体 / Kyūjitai")}</option>
          <option value="simplified">{uiText("简体 / Simplified")}</option><option value="traditional">{uiText("繁体 / Traditional")}</option>
        </select>
      </label>
      <label>{uiText("区域 / Locale")}
        <select aria-label={uiText("Locale")} value={policy.locale || ''} onChange={(e) => update('locale',e.target.value)}>
          <option value="">{uiText("未指定 / Unspecified")}</option><option value="ja-JP">{uiText("日本 / ja-JP")}</option><option value="ko-KR">{uiText("한국 / ko-KR")}</option><option value="zh-Hans">{uiText("简体中文 / zh-Hans")}</option><option value="zh-Hant">{uiText("繁体中文 / zh-Hant")}</option>
        </select>
      </label>
      <label>{uiText("时期 / Period")}<input aria-label={uiText("Period")} value={policy.period || ''} onChange={(e) => update('period',e.target.value)} /></label>
      <label>{uiText("作品 / Work")}<input aria-label={uiText("Work")} value={policy.work || ''} onChange={(e) => update('work',e.target.value)} placeholder="Yuji Mai / ぢぐち" /></label>
      <label>{uiText("书家或设计师 / Author")}<input aria-label={uiText("Designer")} value={policy.designer || ''} onChange={(e) => update('designer',e.target.value)} /></label>
      <label className="check-field"><input type="checkbox" checked={policy.commercial_only || false} onChange={(e) => onChange({ ...policy, commercial_only: e.target.checked })} />{uiText("仅明确允许商用 / Commercially permitted")}</label>
    </details>
    {policy.mode === 'cross-tradition' && <p className="field-hint">{uiText("跨传统候选需逐字复核。Shared Unicode does not imply regional compatibility.")}</p>}
  </div>
}
