import { fontEntries, fontGlyphForCluster, type FontEntry } from '../api/fonts'
import { initialCandidates, type CandidateSource } from '../api/candidates'
import type { Glyph, GlyphInstance } from '../types'
import type { LayoutUnit, TextLine, TextRun, TypesettingOptions } from '../types/typesetting'
import { fontFallbackPolicy, traditionLocale, type CandidatePolicy } from './candidatePolicy'
import { placeGlyph } from './composition'
import { rasterizeOpenTypeRun, shapeOpenTypeRun, type ShaperFont } from './fontShaper'
import { analyzeText, runsForLine } from './textLayout'

interface SourceOptions {
  source: CandidateSource
  policy: CandidatePolicy
  style: string
  discretionary: boolean
}
interface FontPiece {
  units: LayoutUnit[]
  font?: FontEntry
  original?: Glyph
}
interface Placement {
  glyph: Glyph
  x: number
  y: number
  scale: number
  rotation: number
}

function charsetPolicy(unit: LayoutUnit, options: SourceOptions): CandidatePolicy {
  const { policy } = options
  if (!policy.writing_tradition || policy.writing_tradition === unit.tradition) {
    return { ...policy, writing_tradition: unit.tradition, vertical: unit.direction === 'ttb' }
  }
  return { writing_tradition: unit.tradition, locale: traditionLocale(unit.tradition),
    commercial_only: policy.commercial_only, mode: 'strict', vertical: unit.direction === 'ttb' }
}

async function chooseSource(unit: LayoutUnit, options: SourceOptions): Promise<{ font?: FontEntry; original?: Glyph }> {
  const style = unit.tradition === 'Chinese' && !options.policy.dataset ? options.style : ''
  const policy = charsetPolicy(unit, options)
  if (options.source === 'fonts' || options.source === 'all' || policy.font_id) {
    let choices = await fontEntries(unit.text, style, '', policy)
    if (!choices.length && policy.font_id && policy.allow_font_fallback) {
      choices = await fontEntries(unit.text, style, '', fontFallbackPolicy(policy))
    }
    if (choices.length) return { font: choices[0] }
    if (options.source === 'fonts' || policy.font_id || unit.kind === 'tcy') return {}
  }
  const source = options.source === 'all' ? 'original' : options.source
  const candidates = await initialCandidates(unit.text, source, style, 4, undefined, policy)
  return { original: candidates.items.find((glyph) => glyph.character === unit.text) }
}

async function piecesForRun(run: TextRun, units: LayoutUnit[], options: SourceOptions,
  cache: Map<string, Promise<{ font?: FontEntry; original?: Glyph }>>) {
  const pieces: FontPiece[] = []
  for (const unit of units) {
    const key = JSON.stringify([unit.text, unit.tradition, unit.direction, unit.kind])
    let pending = cache.get(key)
    if (!pending) {
      pending = unit.kind === 'space' ? Promise.resolve({}) : chooseSource(unit, options)
      cache.set(key, pending)
    }
    const selected = await pending
    const previous = pieces.at(-1)
    if (selected.font && previous?.font?.id === selected.font.id && !run.tcy) previous.units.push(unit)
    else pieces.push({ ...selected, units: [unit] })
  }
  return pieces
}

async function shapePiece(run: TextRun, piece: FontPiece, options: SourceOptions, vertical: boolean) {
  const font = piece.font!
  const source: ShaperFont = { ...font, ...font.opentype }
  const text = piece.units.map((unit) => unit.text).join('')
  const start = piece.units[0].start
  const locale = run.language === 'en' ? 'en'
    : run.language === font.language && font.locale ? font.locale : run.language
  let direction = vertical ? run.direction : 'ltr' as const
  const params = { start, script: run.script, locale, discretionary: options.discretionary, group: run.tcy }
  if (direction === 'ttb' && run.orientation === 'Tr') {
    const upright = await shapeOpenTypeRun(source, text, { ...params, direction: 'ttb' })
    const horizontal = await shapeOpenTypeRun(source, text, { ...params, direction: 'ltr' })
    const differs = upright && horizontal && upright.sequence.positions.some((item, index) =>
      item.id !== horizontal.sequence.positions[index]?.id)
    if (!differs) direction = 'ltr'
  }
  const raster = await rasterizeOpenTypeRun(source, text, { ...params, direction })
  if (!raster?.clusters.length) return null
  const rotation = vertical && direction === 'ltr' && !run.tcy ? 90 : 0
  const advance = raster.sequence.positions.reduce((total, glyph) =>
    total + (direction === 'ttb' ? glyph.advanceY : glyph.advanceX), 0)
  run.sequences.push({ ...raster.sequence, positions: raster.sequence.positions.map((glyph) => ({ ...glyph, rotation })) })
  return { ...raster, rotation, advance }
}

async function placeLine(
  line: TextLine, lineIndex: number, lineCount: number,
  options: SourceOptions & { vertical: boolean; gapEm: number },
  cache: Map<string, Promise<{ font?: FontEntry; original?: Glyph }>>,
) {
  const { vertical, gapEm } = options
  const cross = (vertical ? lineCount - lineIndex - 1 : lineIndex) * (1 + gapEm)
  let cursor = 0
  const results: Placement[] = []
  const missing: LayoutUnit[] = []
  const runs = runsForLine(line)
  const byStart = new Map(line.units.map((unit, index) => [unit.start, index]))
  for (const run of runs) {
    const from = byStart.get(run.start)!
    const until = line.units.findIndex((unit, index) => index >= from && unit.end === run.end)
    for (const piece of await piecesForRun(run, line.units.slice(from, until + 1), options, cache)) {
      const unit = piece.units[0]
      const approximate = piece.units.reduce((total, current) => total + current.advanceEm, 0)
      const shaped = piece.font && await shapePiece(run, piece, options, vertical)
      if (!shaped) {
        if (piece.original) {
          const original = piece.original
          results.push({ glyph: original, x: vertical ? cross + .5 : cursor + approximate / 2,
            y: vertical ? cursor + approximate / 2 : cross + .5,
            scale: .86 / Math.max(original.asset.width, original.asset.height),
            rotation: vertical && unit.orientation === 'R' ? 90 : 0 })
        } else if (unit.kind !== 'space') missing.push(...piece.units)
        cursor += approximate + (unit.kind === 'space' ? 0 : gapEm)
        continue
      }
      const compressed = !run.tcy && piece.units.every((item) => item.advanceEm === .5)
      const factor = compressed && shaped.advance > approximate ? approximate / shaped.advance : 1
      for (const group of shaped.clusters) {
        const glyph = fontGlyphForCluster(piece.font!, group)
        const width = group.width / group.pixelsPerEm
        const height = group.height / group.pixelsPerEm
        const centerX = group.originX + width / 2
        const centerY = group.originY + height / 2
        const tcyScale = Math.min(1, .92 / Math.max(.01, width, height))
        const x = run.tcy ? cross + .5 : !vertical ? cursor + centerX * factor
          : shaped.rotation ? cross + .5 - (centerY + .35) : cross + .5 + centerX * factor
        const y = run.tcy ? cursor + .5 : !vertical ? cross + .8 + centerY * factor
          : cursor + (shaped.rotation ? centerX : centerY) * factor
        results.push({ glyph, x, y, scale: (run.tcy ? tcyScale : factor) / group.pixelsPerEm,
          rotation: shaped.rotation })
      }
      cursor += (run.tcy ? 1 : compressed ? approximate : Math.max(.1, shaped.advance)) + gapEm
    }
  }
  return { results, missing, runs, advance: cursor }
}

export async function composeTypeset(
  text: string, options: TypesettingOptions & SourceOptions & { measure: number; size: number; gap: number; margin: number },
) {
  const layout = analyzeText(text, options, options.measure)
  if (!layout.units.length || layout.units.length > 1000) throw new RangeError('The advanced workbench accepts 1–1,000 layout units')
  const vertical = options.layout === 'vertical-rtl'
  const gapEm = options.gap / options.size
  const cache = new Map<string, Promise<{ font?: FontEntry; original?: Glyph }>>()
  const lines = []
  for (const [index, line] of layout.lines.entries()) {
    lines.push(await placeLine(line, index, layout.lines.length, { ...options, gapEm, vertical }, cache))
  }
  const records = lines.flatMap((line) => line.results)
  const along = Math.max(...lines.map((line) => line.advance), 1)
  const across = layout.lines.length * (1 + gapEm)
  const margin = options.margin + options.size * .2
  const width = margin * 2 + (vertical ? across : along) * options.size
  const height = margin * 2 + (vertical ? along : across) * options.size
  const fit = Math.min(1, 8000 / width, 8000 / height, Math.sqrt(20_000_000 / (width * height)))
  const glyphs: GlyphInstance[] = records.map((record) => {
    const instance = placeGlyph(record.glyph, (margin + record.x * options.size) * fit,
      (margin + record.y * options.size) * fit, options.size * fit)
    instance.transform.scaleX = instance.transform.scaleY = record.scale * options.size * fit
    instance.transform.rotation = record.rotation
    return instance
  })
  return { glyphs, missing: lines.flatMap((line) => line.missing), runs: lines.flatMap((line) => line.runs),
    clusters: layout.clusters, width: Math.max(100, width * fit), height: Math.max(100, height * fit) }
}
