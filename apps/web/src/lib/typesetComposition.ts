import { fontEntries, fontGlyphForCluster, fontGlyphs, type FontEntry } from '../api/fonts'
import { initialCandidates, type CandidateSource } from '../api/candidates'
import type { Glyph, GlyphInstance } from '../types'
import type { FlowSettings, LayoutUnit, TextLine, TextRun, TypesettingOptions } from '../types/typesetting'
import { candidateCompatible, fontFallbackPolicy, traditionLocale, type CandidatePolicy } from './candidatePolicy'
import { placeGlyph } from './composition'
import { rasterizeOpenTypeRun, shapeOpenTypeRun, type ShaperFont } from './fontShaper'
import { analyzeText, runsForLine, segmentText } from './textLayout'
import type { RollOptions, RollPage } from './longRoll'
import { isLacuna, restorationCandidates, restorationDecision, type RestorationCandidate, type RestorationRecord, type RestorationSlot } from './glyphRestoration'
import { selectSequence, type ProfileCandidate } from './beam'
import { getVisualProfile } from './featureCache'
import type { VisualProfile } from './visual'
import { uiText } from '../i18n'
import { privateGlyphs } from './privateLibrary'

interface SourceOptions {
  source: CandidateSource
  policy: CandidatePolicy
  style: string
  discretionary: boolean
  flow?: FlowSettings
  connectedKana?: boolean
  signal?: AbortSignal
}
interface GlyphSourceChoice { font?: FontEntry; original?: Glyph }
type SourceCache = Map<string, Promise<GlyphSourceChoice[]>>
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
  start: number
  end: number
  optical: boolean
}

function adjustRhythm(records: Placement[], vertical: boolean, strength: number, gapEm: number) {
  const axis = vertical ? 'y' : 'x'
  const extent = (record: Placement) => {
    const height = vertical !== Boolean(record.rotation)
    return (height ? record.glyph.asset.height : record.glyph.asset.width) * record.scale / 2
  }
  let shift = 0
  for (const [index, record] of records.entries()) {
    const previous = records[index - 1]
    if (!record.optical) {
      record[axis] += shift
      continue
    }
    const longest = Math.max(record.glyph.asset.width, record.glyph.asset.height) * record.scale
    record.scale *= 1 + Math.max(-.06, Math.min(.06, (.82 - longest) * .4)) * strength
    if (previous?.optical && previous.end === record.start) {
      const gap = record[axis] + shift - extent(record) - (previous[axis] + extent(previous))
      const target = .12 + gapEm
      shift += gap < .025 ? .025 - gap : Math.max(-.12, Math.min(.12, (target - gap) * strength))
    }
    record[axis] += shift
  }
  return shift
}

function charsetPolicy(unit: LayoutUnit, options: SourceOptions): CandidatePolicy {
  const { policy } = options
  if (!policy.writing_tradition || policy.writing_tradition === unit.tradition) {
    return { ...policy, writing_tradition: unit.tradition, vertical: unit.direction === 'ttb' }
  }
  return { writing_tradition: unit.tradition, locale: traditionLocale(unit.tradition),
    commercial_only: policy.commercial_only, mode: 'strict', vertical: unit.direction === 'ttb' }
}

async function chooseSources(unit: LayoutUnit, options: SourceOptions): Promise<GlyphSourceChoice[]> {
  const style = unit.tradition === 'Chinese' && !options.policy.dataset ? options.style : ''
  const policy = charsetPolicy(unit, options)
  if (unit.kind === 'original-group') {
    return (await privateGlyphs(unit.text, policy)).filter((item) => item.metadata?.original_group)
      .map((original) => ({ original }))
  }
  if (options.source === 'fonts' || options.source === 'all' || policy.font_id) {
    let choices = await fontEntries(unit.text, style, '', policy)
    if (!choices.length && policy.font_id && policy.allow_font_fallback) {
      choices = await fontEntries(unit.text, style, '', fontFallbackPolicy(policy))
    }
    if (choices.length) return choices.map((font) => ({ font }))
    if (options.source === 'fonts' || policy.font_id || unit.kind === 'tcy') return []
  }
  const source = options.source === 'all' ? 'original' : options.source
  const candidates = await initialCandidates(unit.text, source, style, 4, options.signal, policy)
  return candidates.items.filter((glyph) => glyph.character === unit.text).map((original) => ({ original }))
}

function choicesFor(unit: LayoutUnit, options: SourceOptions, cache: SourceCache) {
  options.signal?.throwIfAborted()
  const key = JSON.stringify([unit.text, unit.tradition, unit.direction, unit.kind])
  let choices = cache.get(key)
  if (!choices) {
    choices = ['glyph', 'tcy', 'original-group'].includes(unit.kind) && !isLacuna(unit.text) ? chooseSources(unit, options) : Promise.resolve([])
    cache.set(key, choices)
  }
  return choices
}

async function optimizeLine(line: TextLine, options: SourceOptions, cache: SourceCache, vertical: boolean) {
  const result = { choices: new Map<number, GlyphSourceChoice>(), score: null as number | null }
  if (!options.flow) return result
  const { intensity, pins, mode } = options.flow
  const lookup = new Map<string, GlyphSourceChoice>()
  const choicesAt: ProfileCandidate[][] = []
  const profiles = new Map<string, Promise<VisualProfile>>()
  for (const unit of line.units) {
    const choices = await choicesFor(unit, options, cache)
    const pin = pins.find((entry) => entry.start === unit.start && entry.end === unit.end)
    const matches = pin ? choices.filter(({ font, original }) => (font?.id || original?.id) === pin.glyphId)
      : choices.filter((item, index) => index === 0 || item.font?.source_role !== 'coverage-fallback').slice(0, 4)
    if (pin && !matches.length) throw new Error(uiText('固定字形与当前来源或文字不匹配。'))
    const eligible = unit.kind === 'glyph' && (mode === 'fluent' && intensity > 0 || pin) &&
      ['Han', 'Hiragana', 'Katakana', 'Hangul'].includes(unit.script || '')
    if (!eligible) {
      if (matches[0]) result.choices.set(unit.start, matches[0])
      choicesAt.push([])
      continue
    }
    const profiled: ProfileCandidate[] = []
    for (const choice of matches) {
      const id = JSON.stringify([unit.text, choice.font?.id || choice.original?.id])
      let profile = profiles.get(id)
      if (!profile) {
        profile = (async () => {
          const glyph = choice.original || (await fontGlyphs(unit.text, '', '', {
            ...charsetPolicy(unit, options), font_id: choice.font?.id, allow_font_fallback: false,
          }))[0]
          if (!glyph) throw new Error('Cannot profile the chosen font glyph.')
          return getVisualProfile(glyph)
        })()
        profiles.set(id, profile)
      }
      const visual = await profile.catch(() => null)
      if (!visual || visual.empty) continue
      lookup.set(id, choice)
      profiled.push({ id, character: unit.text, profile: visual })
    }
    if (!profiled.length && matches[0]) result.choices.set(unit.start, matches[0])
    choicesAt.push(profiled)
  }
  const context = choicesAt.flatMap((items) => items[0] ? [items[0].profile] : []).slice(0, 24)
  if (!context.length) return result
  const selected = await selectSequence(line.units.map((unit) => unit.text), new Map(), context, {
    width: 8, variation: intensity * .15, choicesAt, signal: options.signal,
    onCost: (cost) => { result.score = cost / choicesAt.filter((item) => item.length).length },
    adjacentCost: (previous, next) => {
      const exit = previous.flowEdges[vertical ? 3 : 1]
      const entry = next.flowEdges[vertical ? 2 : 0]
      if (!exit.length || !entry.length) return 0
      return intensity * (.5 * Math.abs(exit[0] - entry[0]) +
        .18 * Math.abs(exit[1] - entry[1]) + .18 * Math.abs(exit[2] + entry[2]) +
        .14 * Math.abs(exit[3] + entry[3]))
    },
  })
  for (const [index, id] of selected.entries()) if (id) result.choices.set(line.units[index].start, lookup.get(id)!)
  return result
}

async function piecesForRun(run: TextRun, units: LayoutUnit[], options: SourceOptions,
  cache: SourceCache, optimized: Map<number, GlyphSourceChoice>) {
  const pieces: FontPiece[] = []
  for (const unit of units) {
    const selected = optimized.get(unit.start) ?? (await choicesFor(unit, options, cache))[0] ?? {}
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
  cache: SourceCache,
) {
  const { vertical, gapEm } = options
  const cross = (vertical ? lineCount - lineIndex - 1 : lineIndex) * (1 + gapEm)
  let cursor = 0
  const results: Placement[] = []
  const missing: LayoutUnit[] = []
  const missingPositions: RestorationSlot[] = []
  const runs = runsForLine(line)
  const optimized = await optimizeLine(line, options, cache, vertical)
  const byStart = new Map(line.units.map((unit, index) => [unit.start, index]))
  for (const run of runs) {
    options.signal?.throwIfAborted()
    const from = byStart.get(run.start)!
    const until = line.units.findIndex((unit, index) => index >= from && unit.end === run.end)
    for (const piece of await piecesForRun(run, line.units.slice(from, until + 1), options, cache, optimized.choices)) {
      const unit = piece.units[0]
      const optical = unit.kind === 'glyph' && !run.tcy && ['Han', 'Hiragana', 'Katakana', 'Hangul'].includes(run.script || '')
      const approximate = piece.units.reduce((total, current) => total + current.advanceEm, 0)
      const shaped = piece.font && await shapePiece(run, piece, options, vertical)
      if (!shaped) {
        if (piece.original) {
          const original = piece.original
          const grouped = unit.kind === 'original-group'
          const across = vertical ? original.asset.width : original.asset.height
          const along = vertical ? original.asset.height : original.asset.width
          results.push({ glyph: original, x: vertical ? cross + .5 : cursor + approximate / 2,
            y: vertical ? cursor + approximate / 2 : cross + .5,
            scale: .86 * (grouped ? Math.min(1 / across, approximate / along) : 1 / Math.max(across, along)),
            rotation: vertical && unit.orientation === 'R' ? 90 : 0, start: unit.start, end: unit.end, optical })
        } else if (unit.kind !== 'space') {
          let offset = cursor
          for (const lost of piece.units) {
            missing.push(lost)
            const center = offset + lost.advanceEm / 2
            missingPositions.push({ start: lost.start, end: lost.end, text: lost.text, tradition: lost.tradition,
              x: vertical ? cross + .5 : center, y: vertical ? center : cross + .5, size: .86 })
            offset += lost.advanceEm
          }
        }
        cursor += approximate + (unit.kind === 'space' ? 0 : gapEm)
        continue
      }
      const compressed = !run.tcy && piece.units.every((item) => item.advanceEm === .5)
      const factor = compressed && shaped.advance > approximate ? approximate / shaped.advance : 1
      for (const [index, group] of shaped.clusters.entries()) {
        const glyph = await fontGlyphForCluster(piece.font!, group)
        const width = group.width / group.pixelsPerEm
        const height = group.height / group.pixelsPerEm
        const centerX = group.originX + width / 2
        const centerY = group.originY + height / 2
        const tcyScale = Math.min(1, .92 / Math.max(.01, width, height))
        const advance = cursor + gapEm * index
        const x = run.tcy ? cross + .5 : !vertical ? advance + centerX * factor
          : shaped.rotation ? cross + .5 - (centerY + .35) : cross + .5 + centerX * factor
        const y = run.tcy ? cursor + .5 : !vertical ? cross + .8 + centerY * factor
          : advance + (shaped.rotation ? centerX : centerY) * factor
        results.push({ glyph, x, y, scale: (run.tcy ? tcyScale : factor) / group.pixelsPerEm,
          rotation: shaped.rotation, start: group.sequence.start, end: group.sequence.end, optical })
      }
      cursor += (run.tcy ? 1 : compressed ? approximate : Math.max(.1, shaped.advance)) + gapEm * shaped.clusters.length
    }
  }
  if (options.flow?.intensity) cursor += adjustRhythm(results, vertical, options.flow.intensity, gapEm)
  return { results, missing, missingPositions, runs, advance: cursor, flowCost: optimized.score }
}

function materialize(record: Placement, marginX: number, marginY: number, em: number): GlyphInstance {
  const instance = placeGlyph(record.glyph, marginX + record.x * em, marginY + record.y * em, em)
  instance.transform.scaleX = instance.transform.scaleY = record.scale * em
  instance.transform.rotation = record.rotation
  instance.textRange = { start: record.start, end: record.end }
  return instance
}

async function layoutOptions(text: string, options: TypesettingOptions & SourceOptions) {
  if (!options.connectedKana || !['all', 'private'].includes(options.source) ||
      options.policy.font_id || !(options.tradition === 'Japanese' || options.mixed)) return options
  const policy = { ...options.policy, writing_tradition: 'Japanese', locale: 'ja-JP' }
  const byFirst = new Map<string, string[]>()
  for (const glyph of await privateGlyphs()) {
    if (!glyph.metadata?.original_group || glyph.provenance.type !== 'original' || !candidateCompatible(glyph, policy)) continue
    const first = segmentText(glyph.character)[0]?.text
    if (first) byFirst.set(first, [...new Set([...(byFirst.get(first) || []), glyph.character])])
  }
  const clusters = segmentText(text)
  const boundaries = new Set(clusters.map((item) => item.end))
  const originalGroups = []
  let consumed = 0
  for (const { text: first, start } of clusters) {
    if (start < consumed) continue
    const matches = byFirst.get(first)?.filter((group) => text.startsWith(group, start) && boundaries.has(start + group.length))
    if (!matches?.length) continue
    consumed = start + Math.max(...matches.map((group) => group.length))
    originalGroups.push({ start, end: consumed })
  }
  return { ...options, originalGroups }
}

export async function composeTypeset(
  text: string, options: TypesettingOptions & SourceOptions & { measure: number; size: number; gap: number; margin: number },
) {
  const layout = analyzeText(text, await layoutOptions(text, options), options.measure)
  if (!layout.units.length || layout.units.length > 1000) throw new RangeError('The advanced workbench accepts 1–1,000 layout units')
  const vertical = options.layout === 'vertical-rtl'
  const gapEm = options.gap / options.size
  const cache: SourceCache = new Map()
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
  const glyphs = records.map((record) => materialize(record, margin * fit, margin * fit, options.size * fit))
  return { glyphs, missing: lines.flatMap((line) => line.missing), runs: lines.flatMap((line) => line.runs),
    missingPositions: lines.flatMap((line) => line.missingPositions).map((slot) => ({ ...slot,
      x: (margin + slot.x * options.size) * fit, y: (margin + slot.y * options.size) * fit, size: slot.size * options.size * fit,
    })),
    flowCosts: lines.flatMap(({ flowCost }) => flowCost === null ? [] : [flowCost]),
    clusters: layout.clusters, width: Math.max(100, width * fit), height: Math.max(100, height * fit) }
}

export async function typesetScroll(text: string, options: TypesettingOptions & SourceOptions & RollOptions) {
  if (![options.rows, options.columns].every((n) => Number.isInteger(n) && n >= 2 && n <= 24)) {
    throw new RangeError('Each scroll page must contain 2–24 lines or columns')
  }
  const vertical = options.vertical
  const measure = vertical ? options.rows : options.columns
  const capacity = vertical ? options.columns : options.rows
  const layout = analyzeText(text, await layoutOptions(text, options), measure)
  if (!layout.units.length || layout.units.length > 20000) throw new RangeError('Long Scroll accepts 1–20,000 layout units')
  const cache: SourceCache = new Map()
  const clusterIndices = new Map(layout.clusters.map((item, index) => [item.start, index]))
  const pages: RollPage[] = []
  const unresolved: LayoutUnit[] = []
  const recovery = new Map<string, RestorationCandidate | undefined>()
  const gapEm = .08
  for (let start = 0; start < layout.lines.length; start += capacity) {
    options.signal?.throwIfAborted()
    const chunk = layout.lines.slice(start, start + capacity)
    const lines = []
    for (const [index, line] of chunk.entries()) {
      lines.push(await placeLine(line, index, capacity, { ...options, gapEm }, cache))
    }
    const along = Math.max(measure, ...lines.map((line) => line.advance))
    const across = capacity * (1 + gapEm)
    const em = Math.min(704 / (vertical ? across : along), 980 / (vertical ? along : across))
    const marginX = vertical ? 752 - across * em : 48
    const slots = lines.flatMap((line, track) => line.results.map((record) => ({
      index: clusterIndices.get(record.start)!, character: record.glyph.character,
      row: vertical ? Math.floor(record.y) : track, column: vertical ? capacity - track - 1 : Math.floor(record.x),
      glyph: materialize(record, marginX, 50, em), cost: null, start: record.start, end: record.end,
    })))
    const restorations: RestorationRecord[] = []
    const pending = new Set<number>()
    const anchor = slots.find((slot) => slot.glyph.provenance.type === 'original')?.glyph.source
    for (const lost of lines.flatMap((line) => line.missingPositions)) {
      options.signal?.throwIfAborted()
      const slot = { ...lost, x: marginX + lost.x * em, y: 50 + lost.y * em, size: lost.size * em }
      const key = JSON.stringify([lost.text, lost.tradition, anchor?.work, anchor?.calligrapher, anchor?.style])
      if (!recovery.has(key) && !isLacuna(lost.text)) {
        const ranked = await restorationCandidates(text, slot, { ...options.policy, vertical }, anchor)
        recovery.set(key, ranked.find((candidate) => candidate.automatic))
      }
      const match = recovery.get(key)
      restorations.push({ ...slot, decisions: match ? [restorationDecision(match, false)] : [] })
      if (!match) { pending.add(slot.start); continue }
      const glyph = placeGlyph(match.glyph, slot.x, slot.y, slot.size)
      glyph.textRange = { start: slot.start, end: slot.end }
      slots.push({ index: clusterIndices.get(slot.start)!, character: slot.text, glyph, cost: null,
        row: Math.floor(lost.y), column: Math.floor(lost.x), start: slot.start, end: slot.end })
    }
    slots.sort((a,b) => a.start - b.start)
    unresolved.push(...lines.flatMap((line) => line.missing).filter((item) => pending.has(item.start)))
    pages.push({ slots, restorations, runs: lines.flatMap((line) => line.runs), measured: true,
      flowCosts: lines.flatMap(({ flowCost }) => flowCost === null ? [] : [flowCost]) })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const missing = new Map<string, number[]>()
  for (const item of unresolved) {
    const occurrences = missing.get(item.text) || []
    occurrences.push(clusterIndices.get(item.start)! + 1)
    missing.set(item.text, occurrences)
  }
  return { pages, count: layout.clusters.length,
    missing: [...missing].map(([character, positions]) => ({ character, positions })) }
}
