import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import ja from './ja-JP.json'
import ko from './ko-KR.json'

const LOCALE_KEY = 'calligra.ui-locale'
export const UI_LOCALES = ['zh-CN', 'ja-JP', 'ko-KR', 'en'] as const
export type UiLocale = typeof UI_LOCALES[number]

function persistedLocale() {
  try { return localStorage.getItem(LOCALE_KEY) } catch { return null }
}

function initialLocale(): UiLocale {
  if (typeof document === 'undefined') return 'zh-CN'
  const preference = persistedLocale()
  if (UI_LOCALES.includes(preference as UiLocale)) return preference as UiLocale
  for (const language of navigator.languages || [navigator.language]) {
    const base = language.toLowerCase().split('-')[0]
    const supported = UI_LOCALES.find((locale) => locale.startsWith(base))
    if (supported) return supported
  }
  return 'en'
}

const locale = initialLocale()
void i18n.use(initReactI18next).init({
  lng: locale, supportedLngs: [...UI_LOCALES], fallbackLng: false,
  resources: { 'zh-CN': { translation: {} }, en: { translation: en },
    'ja-JP': { translation: ja }, 'ko-KR': { translation: ko } },
  load: 'currentOnly', initAsync: false, keySeparator: false, nsSeparator: false,
  interpolation: { escapeValue: false },
})
if (typeof document !== 'undefined') document.documentElement.lang = locale
export const uiText = (key: string, values: Record<string, unknown> = {}): string =>
  i18n.t(key, { ...values, defaultValue: key })

if (typeof document !== 'undefined') document.title = 'Calligra · ' + uiText('集字工作台')

export async function setUiLocale(value: UiLocale) {
  await i18n.changeLanguage(value)
  document.documentElement.lang = value
  document.title = 'Calligra · ' + uiText('集字工作台')
  try { localStorage.setItem(LOCALE_KEY, value) } catch { /* current tab still uses the preference */ }
}

export function guideUrl(section = '') {
  const folders: Record<UiLocale, string> = { 'zh-CN': '', 'ja-JP': 'ja/', 'ko-KR': 'ko/', en: 'en/' }
  return import.meta.env.BASE_URL + 'guide/' + folders[i18n.language as UiLocale] + 'index.html' + section
}
