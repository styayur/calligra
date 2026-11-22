import { useTranslation } from 'react-i18next'
import { UI_LOCALES, setUiLocale, uiText, type UiLocale } from '../../i18n'

const names: Record<UiLocale, string> = { 'zh-CN': '简体中文', 'ja-JP': uiText("日本語"), 'ko-KR': uiText("한국어"), en: 'English' }

export function LanguageSelect() {
  const { i18n } = useTranslation()
  return <label className="ui-language">
    <span className="sr-only">{uiText('界面语言')}</span>
    <select aria-label={uiText('界面语言')} value={i18n.language}
      onChange={(event) => void setUiLocale(event.target.value as UiLocale)}>
      {UI_LOCALES.map((locale) => <option value={locale} key={locale} lang={locale}>{names[locale]}</option>)}
    </select>
  </label>
}
