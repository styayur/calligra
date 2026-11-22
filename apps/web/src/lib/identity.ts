import type { CharacterIdentity, Glyph, RightsRecord } from '../types/glyph'

export const SCHEMA_VERSION = 2
export const codepoints = (text: string) => [...text].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
export function unicodeScript(text: string): string | null {
  if (/^\p{Script=Hiragana}[\p{Script=Hiragana}\p{M}]*$/u.test(text)) return 'Hiragana'
  if (/^\p{Script=Katakana}[\p{Script=Katakana}\p{M}]*$/u.test(text)) return 'Katakana'
  if (/^\p{Script=Han}[\p{Script=Han}\p{M}]*$/u.test(text)) return 'Han'
  if (/^\p{Script=Hangul}[\p{Script=Hangul}\p{M}]*$/u.test(text)) return 'Hangul'
  if (/^\p{Script=Latin}[\p{Script=Latin}\p{M}]*$/u.test(text)) return 'Latin'
  return null
}
export function semanticIdentity(glyph: Glyph): CharacterIdentity {
  return glyph.identity || { text: glyph.character, codepoints: codepoints(glyph.character) }
}
/** Enrich missing legacy fields without inferring culture from shared Han. */
export function migrateGlyph<T extends Glyph>(glyph: T): T {
  const source = glyph.source
  const restricted = /^NCCU Cursive/i.test(source.dataset) ||
    /github\.com\/nccuviplab\/cursivechinesecalligraphydataset/i.test(source.source_uri ?? '')
  const rights = rightsRecord(source.rights)
  // Migrate old demo URLs to portable asset names that Android's APK can address.
  const url = glyph.asset.url.replace(/(\/?demo\/assets\/(?:demo|hanzi-writer-structural-data|ofl-calligraphy-fonts)\/[0-9a-f]{2}\/)[^/?#]+-([0-9a-f]{12}\.(?:svg|png))$/, '$1$2')
  return { ...glyph, identity: semanticIdentity(glyph), variant: glyph.variant || {},
    asset: { ...glyph.asset, url }, source: restricted ? {
      ...source, license: null, license_url: null, license_text: null,
      rights: { ...rights, commercial_use: false, derivatives_allowed: false,
        redistribution_allowed: false, font_export_allowed: false },
    } : { ...source, rights } }
}
export function rightsRecord(value: Record<string, boolean | null> = {}): RightsRecord & Record<string, boolean | null> {
  const rights = { ...value }
  for (const key of ['commercial_use','derivatives_allowed','redistribution_allowed','research_use','attribution_required','font_license','share_alike_required']) {
    if (rights[key] !== undefined && rights[key] !== null && typeof rights[key] !== 'boolean') throw new Error('Invalid rights value')
    rights[key] ??= null
  }
  return rights as RightsRecord & Record<string, boolean | null>
}
/** Grapheme boundaries keep dakuten and variation selectors with their base.
 * Preserve exact input: no NFKC or Han compatibility folding. */
export function textCharacters(text: string): string[] {
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
  return [...segmenter.segment(text)].map(({ segment }) => segment)
}
