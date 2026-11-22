import { uiText } from "../i18n"
import type { Glyph } from '../types'
import type { GlyphSource, VariantType } from '../types/glyph'
import { codepoints, unicodeScript, variationPairs } from '../lib/identity'
import { compatibleSource, fontFallbackPolicy, type CandidatePolicy } from '../lib/candidatePolicy'
import { fontHasExactVariations, shapeFontGlyph, sha256, type OpenTypeCluster } from '../lib/fontShaper'
import { japaneseVariant } from '../lib/orthography'

export interface FontEntry extends GlyphSource {
  id: string
  family: string
  designer: string
  style: string
  characters: string
  license: string
  license_url: string
  rights: Record<string, boolean | null>
  path: string
  renderer: string
  sha256: string
  runtime_sha256: string
  opentype?: { path: string; runtime_sha256: string }
  upstream_commit?: string
  font_version?: string
  original_sha256?: string
  subset_command?: string
  variant_type?: VariantType
}
let catalog: Promise<FontEntry[]> | undefined
const faces = new Map<string, Promise<FontFace>>()
const glyphCache = new Map<string, Glyph>()

export function fontCatalog(): Promise<FontEntry[]> {
  if (!catalog)
    catalog = fetch(`${import.meta.env.BASE_URL}fonts/catalog.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(uiText("内置字库加载失败，请刷新重试"))
        return response.json()
      })
      .catch((error) => {
        catalog = undefined
        throw error
      })
  return catalog
}

function fontVariant(font: FontEntry, character: string): { type?: VariantType; canonical?: string } {
  return font.language === 'ja' ? japaneseVariant(character, font.variant_type) : { type: font.variant_type }
}

export async function fontEntries(character: string, style = '', designer = '', policy: CandidatePolicy = {}): Promise<FontEntry[]> {
  const catalog = await fontCatalog()
  const pairs = variationPairs(character)
  if (!pairs) return []
  const eligible = catalog.filter((font) =>
    (!pairs.length || font.renderer === 'harfbuzz') &&
    [...character.normalize('NFC')].every((c) => font.characters.includes(c) || /\p{M}/u.test(c)) &&
    (!style || font.style === style) &&
    (!designer || font.designer === designer) &&
    compatibleSource({ ...font, script: unicodeScript(character), work: font.family },
      fontVariant(font, character), 'font', policy, font.id),
  )
  const entries = eligible.filter((font) => font.source_role !== 'coverage-fallback')
    .concat(eligible.filter((font) => font.source_role === 'coverage-fallback'))
  if (!pairs.length) return entries
  const support = await Promise.all(entries.map((font) => fontHasExactVariations(font, character)))
  return entries.filter((_, index) => support[index])
}

export async function fontGlyphs(character: string, style = '', designer = '', policy: CandidatePolicy = {}): Promise<Glyph[]> {
  const render = async (selection: CandidatePolicy) => {
    const entries = await fontEntries(character, style, designer, selection)
    return Promise.all(entries.map((font) => renderFontGlyph(font, character, policy.vertical)))
      .then((items) => items.filter((g): g is Glyph => g !== null))
  }
  const matches = await render(policy)
  if (matches.length || !policy.font_id || !policy.allow_font_fallback) return matches
  return render(fontFallbackPolicy(policy))
}

function shapedFontGlyph(
  font: FontEntry,
  id: string,
  character: string,
  asset: Glyph['asset'],
  shaping: Record<string, unknown> & { font_glyph_ids: number[]; glyph_names: (string | undefined)[] },
): Glyph {
  const variant = fontVariant(font, character)
  return {
    id, character,
    identity: { text: character, codepoints: codepoints(character), language: font.language, locale: font.locale, script: unicodeScript(character), canonical:variant.canonical },
    variant: { type:variant.type, id, font_glyph_id: shaping.font_glyph_ids[0], glyph_name: shaping.glyph_names[0] },
    source: { dataset: font.dataset, work: font.family, source_role: font.source_role, source_checksum: font.sha256, dataset_version: font.upstream_commit,
      language:font.language, locale:font.locale, script:unicodeScript(character), writing_tradition:font.writing_tradition,
      orthography:font.orthography, period:font.period, region:font.region, source_collection:font.source_collection,
      designer:font.designer, calligrapher:font.designer, style:font.style, source_uri:font.source_uri,
      license:font.license, license_url:font.license_url, license_text:font.license_text, attribution:font.attribution, rights:font.rights },
    asset,
    transform: { x:0,y:0,scaleX:.3,scaleY:.3,rotation:0,skewX:0,skewY:0 },
    appearance: { opacity:1,blendMode:'multiply' }, provenance: { type:'font' }, metadata: { shaping: shaping, font_id:font.id, font_version:font.font_version, upstream_commit:font.upstream_commit,
      source_role:font.source_role, original_sha256:font.original_sha256, subset_command:font.subset_command },
  }
}

export function fontGlyphForCluster(font: FontEntry, cluster: OpenTypeCluster): Glyph {
  const { text } = cluster.sequence
  const id = 'font-run:' + font.id + ':' + cluster.checksum.slice(0, 24)
  return shapedFontGlyph(font, id, text, {
    type: 'raster', url: cluster.url, checksum: cluster.checksum,
    width: cluster.width, height: cluster.height, bbox: [0, 0, cluster.width, cluster.height],
  }, cluster.shaping)
}

async function renderFontGlyph(font: FontEntry, character: string, vertical?: boolean): Promise<Glyph | null> {
  const id = `font:${font.id}:${character}${vertical ? ':vertical' : ''}`
  const cacheKey = JSON.stringify([id, font.locale, font.sha256, font.runtime_sha256])
  const cached = glyphCache.get(cacheKey)
  if (cached) return cached
  const shaped = font.renderer === 'harfbuzz' ? await shapeFontGlyph(font, character, font.locale || 'ja-JP', vertical) : null
  if (font.renderer === 'harfbuzz' && !shaped) return null
  if (shaped) {
    const glyph = shapedFontGlyph(font, id, character,
      { type: 'raster', url: shaped.url, checksum: shaped.checksum, width: 512, height: 512, bbox: [0, 0, 512, 512] },
      shaped.shaping)
    glyphCache.set(cacheKey,glyph)
    if (glyphCache.size > 2048) glyphCache.delete(glyphCache.keys().next().value!)
    return glyph
  }
  if (!faces.has(font.id)) {
    const face = new FontFace(
      font.id,
      `url("${import.meta.env.BASE_URL}fonts/${font.id}.woff2")`,
    )
    faces.set(
      font.id,
      face
        .load()
        .then((loaded) => {
          document.fonts.add(loaded)
          return loaded
        })
        .catch((error) => {
          faces.delete(font.id)
          throw error
        }),
    )
  }
  await faces.get(font.id)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const context = canvas.getContext('2d')!
  context.font = `400px "${font.id}"`
  const metrics = context.measureText(character)
  const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
  const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
  const scale = Math.min(448 / Math.max(width, 1), 448 / Math.max(height, 1))
  context.translate(256, 256)
  context.scale(scale, scale)
  context.fillStyle = '#171b1a'
  context.fillText(
    character,
    (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
    (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
  )
  const glyph: Glyph = {
    id,
    character,
    identity: { text: character, codepoints: codepoints(character), script: unicodeScript(character), language: font.language, locale: font.locale },
    variant: { id, type: font.variant_type },
    source: {
      dataset: 'OFL Calligraphy Fonts',
      calligrapher: font.designer,
      style: font.style,
      dynasty: '当代',
      work: font.family,
      license: font.license,
      license_url: font.license_url,
      rights: font.rights,
      language: font.language, locale: font.locale, script: unicodeScript(character), writing_tradition: font.writing_tradition,
      source_uri: font.source_uri, source_checksum: font.sha256, license_text: font.license_text, designer: font.designer,
      attribution:font.attribution || font.designer,
    },
    asset: {
      type: 'raster',
      url: canvas.toDataURL('image/png'),
      checksum:await sha256(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer()),
      width: 512,
      height: 512,
      bbox: [0, 0, 512, 512],
    },
    transform: { x: 0, y: 0, scaleX: 0.3, scaleY: 0.3, rotation: 0, skewX: 0, skewY: 0 },
    appearance: { opacity: 1, blendMode: 'multiply' },
    provenance: { type: 'font' },
    metadata:{ font_id:font.id, shaping:{engine:'browser-legacy',source_sequence:character,locale_aware:false,font_sha256:font.sha256} },
  }
  glyphCache.set(cacheKey, glyph)
  if (glyphCache.size > 2048) glyphCache.delete(glyphCache.keys().next().value!)
  return glyph
}
