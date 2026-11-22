import type { Font, Blob as HBBlob, Face } from 'harfbuzzjs'
import { unicodeScript, variationPairs } from './identity'
import type { GlyphSequence, InlineDirection } from '../types/typesetting'
import type { Glyph } from '../types'

const fonts = new Map<string, Promise<{ font: Font; blob: HBBlob; face: Face }>>()
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((v) => v.toString(16).padStart(2, '0')).join('')
}
export interface ShaperFont { id: string; path: string; sha256: string; runtime_sha256: string }
export async function bundledFontBytes(entry: ShaperFont) {
  const response = await fetch(`${import.meta.env.BASE_URL}fonts/${entry.path}`)
  if (!response.ok) throw new Error('Bundled font could not be loaded')
  const compressed = await response.arrayBuffer()
  if (await sha256(compressed) !== entry.runtime_sha256) throw new Error('Bundled runtime font checksum mismatch')
  const raw = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  if (raw.byteLength > 40 * 1024 * 1024 || await sha256(raw) !== entry.sha256) throw new Error('Bundled source font checksum mismatch')
  return raw
}
async function loadShapingFont(entry: ShaperFont) {
  const hb = await import('harfbuzzjs')
  const key = [entry.id, entry.sha256, entry.runtime_sha256].join(':')
  if (!fonts.has(key)) fonts.set(key, (async () => {
    const raw = await bundledFontBytes(entry)
    const blob = new hb.Blob(raw), face = new hb.Face(blob), font = new hb.Font(face)
    font.setScale(face.upem, face.upem)
    return { font, blob, face }
  })().catch((error) => { fonts.delete(key); throw error }))
  return { hb, ...await fonts.get(key)! }
}

export async function fontHasExactVariations(entry: ShaperFont, text: string): Promise<boolean> {
  const pairs = variationPairs(text)
  if (!pairs) return false
  if (!pairs.length) return true
  const { font } = await loadShapingFont(entry)
  return pairs.every(([base, selector]) => Boolean(font.variationGlyph(base, selector)))
}

interface ShapingOptions {
  locale: string
  start?: number
  script?: string | null
  direction: InlineDirection
  discretionary?: boolean
  /** A compact horizontal group shares one raster and one vertical cell. */
  group?: boolean
}

export interface OpenTypeCluster {
  sequence: GlyphSequence
  url: string
  checksum: string
  width: number
  height: number
  originX: number
  originY: number
  pixelsPerEm: number
  shaping: {
    engine: 'harfbuzz-wasm'
    harfbuzz_version: string
    source_sequence: string
    font_glyph_ids: number[]
    glyph_names: (string | undefined)[]
    locale: string
    direction: InlineDirection
    features: string[]
    positions: GlyphSequence['positions']
    font_sha256: string
  }
}
const clusterRaster = new Map<string, { url: string; checksum: string }>()

export async function rasterizeOpenTypeRun(entry: ShaperFont, text: string, options: ShapingOptions) {
  const shaped = await shapeOpenTypeRun(entry, text, options)
  if (!shaped) return null
  const { sequence, face, font, version } = shaped
  const groups = new Map<number, GlyphSequence['positions']>()
  for (const glyph of sequence.positions) {
    const start = options.group ? sequence.start : glyph.cluster
    const group = groups.get(start) || []
    group.push(glyph)
    groups.set(start, group)
  }
  const keys = [...groups.keys()].sort((a, b) => a - b)
  const clusters: OpenTypeCluster[] = []
  for (const [index, start] of keys.entries()) {
    const end = keys[index + 1] ?? sequence.end
    const glyphs = groups.get(start)!
    const boxes = glyphs.flatMap((glyph) => {
      const bounds = font.glyphExtents(glyph.id)
      if (!bounds || bounds.width <= 0 || bounds.height >= 0) return []
      const x = glyph.x + bounds.xBearing / face.upem
      const y = glyph.y - bounds.yBearing / face.upem
      return [{ x, y, right: x + bounds.width / face.upem, bottom: y - bounds.height / face.upem }]
    })
    if (!boxes.length) continue
    const left = Math.min(...boxes.map((box) => box.x))
    const top = Math.min(...boxes.map((box) => box.y))
    const inkWidth = Math.max(...boxes.map((box) => box.right)) - left
    const inkHeight = Math.max(...boxes.map((box) => box.bottom)) - top
    const pixelsPerEm = Math.min(400, 2000 / Math.max(.01, inkWidth, inkHeight))
    const padding = 4
    const width = Math.ceil(inkWidth * pixelsPerEm) + padding * 2
    const height = Math.ceil(inkHeight * pixelsPerEm) + padding * 2
    const key = JSON.stringify([entry.sha256, width, height, pixelsPerEm,
      glyphs.map((glyph) => [glyph.id, Math.round((glyph.x - left) * 100000), Math.round((glyph.y - top) * 100000)])])
    let raster = clusterRaster.get(key)
    if (!raster) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      const scalar = pixelsPerEm / face.upem
      context.setTransform(scalar, 0, 0, -scalar, padding - left * pixelsPerEm, padding - top * pixelsPerEm)
      context.fillStyle = '#171b1a'
      for (const glyph of glyphs) {
        context.save()
        context.translate(glyph.x * face.upem, -glyph.y * face.upem)
        context.fill(new Path2D(font.glyphToPath(glyph.id)))
        context.restore()
      }
      const url = canvas.toDataURL('image/png')
      raster = { url, checksum: await sha256(await (await fetch(url)).arrayBuffer()) }
      clusterRaster.set(key, raster)
      if (clusterRaster.size > 2048) clusterRaster.delete(clusterRaster.keys().next().value!)
    }
    const source = text.slice(start - sequence.start, end - sequence.start)
    clusters.push({ ...raster, width, height, originX: left - padding / pixelsPerEm,
      originY: top - padding / pixelsPerEm, pixelsPerEm,
      sequence: { ...sequence, start, end, text: source, positions: glyphs },
      shaping: { engine: 'harfbuzz-wasm', harfbuzz_version: version,
        source_sequence: source, locale: options.locale, direction: options.direction, features: sequence.features,
        positions: glyphs, font_sha256: entry.sha256,
        font_glyph_ids: glyphs.map((glyph) => glyph.id), glyph_names: glyphs.map((glyph) => font.glyphName(glyph.id)) },
    })
  }
  return { sequence, clusters }
}

/** HarfBuzz receives a complete run. addText uses UTF-16 offsets in the source. */
export async function shapeOpenTypeRun(entry: ShaperFont, text: string, options: ShapingOptions) {
  const { locale, start = 0, script = unicodeScript(text), direction, discretionary = false } = options
  const { hb, font, face } = await loadShapingFont(entry)
  const pairs = variationPairs(text)
  if (!pairs || pairs.some(([base, selector]) => !font.variationGlyph(base, selector))) return null
  const vertical = direction === 'ttb'
  const buffer = new hb.Buffer()
  buffer.addText(text)
  buffer.guessSegmentProperties()
  buffer.setLanguage(locale)
  const tag = { Han: 'Hani', Hiragana: 'Hira', Katakana: 'Kana', Hangul: 'Hang', Latin: 'Latn' }[script || '']
  if (tag) buffer.setScript(tag)
  buffer.setDirection(vertical ? hb.Direction.TTB : hb.Direction.LTR)
  // vert supplies upright alternates. Sideways runs use horizontal metrics and rotate once at placement.
  const gsub = face.getTableFeatureTags('GSUB')
  const features = ['locl=1', vertical && gsub.includes('vert') ? 'vert=1' : 'vert=0', 'vrt2=0']
  if (discretionary && gsub.includes('dlig')) features.push('dlig=1')
  hb.shape(font, buffer, features.map((f) => hb.Feature.fromString(f)!))
  const infos = buffer.getGlyphInfos(), positions = buffer.getGlyphPositions()
  if (!infos.length || infos.some((g) => !g.codepoint)) return null
  let runX = 0, runY = 0
  const result: GlyphSequence = { start, end: start + text.length, text, fontId: entry.id, features, positions: [] }
  for (const [index, item] of infos.entries()) {
    const position = positions[index], bounds = font.glyphExtents(item.codepoint)
    result.positions.push({
      id: item.codepoint, cluster: start + item.cluster,
      x: (runX + position.xOffset) / face.upem, y: -(runY + position.yOffset) / face.upem,
      advanceX: position.xAdvance / face.upem, advanceY: -position.yAdvance / face.upem,
      width: (bounds?.width ?? 0) / face.upem, height: -(bounds?.height ?? 0) / face.upem, rotation: 0,
    })
    runX += position.xAdvance
    runY += position.yAdvance
  }
  return { sequence: result, infos, positions, font, face, version: hb.versionString(), script }
}

export async function shapeFontGlyph(entry: ShaperFont, text: string, locale: string, vertical = false) {
  const direction = vertical ? 'ttb' : 'ltr'
  const shaped = await shapeOpenTypeRun(entry, text, { locale, direction })
  if (!shaped) return null
  const { sequence, infos, positions, font, face, version, script } = shaped
  const paths: { path: Path2D; x: number; y: number }[] = []
  let penX = 0, penY = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  infos.forEach((g, i) => {
    const p = positions[i], e = font.glyphExtents(g.codepoint), x = penX + p.xOffset, y = penY + p.yOffset
    if (e) {
      left = Math.min(left, x + e.xBearing)
      top = Math.min(top, -y - e.yBearing)
      right = Math.max(right, x + e.xBearing + e.width)
      bottom = Math.max(bottom, -y - e.yBearing - e.height)
    }
    paths.push({ path: new Path2D(font.glyphToPath(g.codepoint)), x, y })
    penX += p.xAdvance; penY += p.yAdvance
  })
  if (![left, top, right, bottom].every(Number.isFinite)) return null
  const width = right - left, height = bottom - top
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!, scale = Math.min(420 / face.upem, 448 / Math.max(1,width), 448 / Math.max(1,height))
  let centerX = 256, centerY = 256
  if (locale === 'ja-JP' && '、。'.includes(text)) {
    centerX = vertical ? 400 : 112; centerY = vertical ? 112 : 400
  }
  ctx.translate(centerX - (left + width/2)*scale, centerY - (top + height/2)*scale)
  ctx.scale(scale, -scale); ctx.fillStyle = '#171b1a'
  for (const p of paths) { ctx.save(); ctx.translate(p.x,p.y); ctx.fill(p.path); ctx.restore() }
  const url = canvas.toDataURL('image/png')
  const checksum = await sha256(await (await fetch(url)).arrayBuffer())
  return { url, checksum, shaping: { engine: 'harfbuzz-wasm', harfbuzz_version: version,
    source_sequence: text, font_glyph_ids: infos.map((g) => g.codepoint), glyph_names: infos.map((g) => font.glyphName(g.codepoint)),
    features: sequence.features, positions: sequence.positions, locale, script, direction, font_sha256: entry.sha256,
    rasterizer: 'canvas-outline', normalization: 'em-scale-v1' } }
}

/** Recover the same outline-to-bitmap coordinates used by the composition renderer. */
export async function artworkOutlines(entry: ShaperFont, glyph: Glyph) {
  const receipt = glyph.metadata?.shaping as Partial<OpenTypeCluster['shaping']> & { rasterizer?: string }
  if (!receipt || receipt.font_sha256 !== entry.sha256 || receipt.source_sequence !== glyph.character) return null
  if (receipt.engine !== 'harfbuzz-wasm' && glyph.asset.width !== 512) return null
  const { font, face } = await loadShapingFont(entry)
  const shaped = receipt.engine === 'harfbuzz-wasm' ? receipt.positions
    : (await shapeOpenTypeRun(entry, glyph.character, { direction: 'ltr', locale: glyph.source.locale || 'zh' }))?.sequence.positions
  if (!Array.isArray(shaped) || !shaped.length || shaped.length > 128 || shaped.some((item) =>
    !Number.isInteger(item.id) || item.id < 1 || item.id > 65535 ||
    !Number.isFinite(item.x) || !Number.isFinite(item.y) || Math.abs(item.x) > 100 || Math.abs(item.y) > 100)) return null
  const bounds = shaped.flatMap((item) => {
    const e = font.glyphExtents(item.id)
    if (!e || e.width <= 0 || e.height >= 0) return []
    const left = item.x + e.xBearing / face.upem
    const top = item.y - e.yBearing / face.upem
    return [{ left, top, right: left + e.width / face.upem, bottom: top - e.height / face.upem }]
  })
  if (!bounds.length) return null
  const left = Math.min(...bounds.map((b) => b.left))
  const top = Math.min(...bounds.map((b) => b.top))
  const width = Math.max(...bounds.map((b) => b.right)) - left
  const height = Math.max(...bounds.map((b) => b.bottom)) - top
  let pixelsPerEm = Math.min(400, 2000 / Math.max(.01, width, height))
  let x = 4 - left * pixelsPerEm
  let y = 4 - top * pixelsPerEm
  if (receipt.rasterizer === 'canvas-outline' || receipt.engine !== 'harfbuzz-wasm') {
    pixelsPerEm = Math.min(receipt.engine === 'harfbuzz-wasm' ? 420 : Infinity, 448 / width, 448 / height)
    const corner = receipt.locale === 'ja-JP' && '、。'.includes(glyph.character)
    x = (corner ? receipt.direction === 'ttb' ? 400 : 112 : 256) - (left + width / 2) * pixelsPerEm
    y = (corner ? receipt.direction === 'ttb' ? 112 : 400 : 256) - (top + height / 2) * pixelsPerEm
  } else if (glyph.asset.width !== Math.ceil(width * pixelsPerEm) + 8 ||
             glyph.asset.height !== Math.ceil(height * pixelsPerEm) + 8) return null
  return shaped.map((item) => ({
    path: font.glyphToPath(item.id), scale: pixelsPerEm / face.upem,
    x: x + item.x * pixelsPerEm, y: y + item.y * pixelsPerEm,
  }))
}
