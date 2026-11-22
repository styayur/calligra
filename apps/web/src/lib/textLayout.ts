import { Rules } from '@cto.af/linebreak'
import type { TextLanguage } from '../types/project'
import type {
  LayoutUnit, TextCluster, TextLayout, TextLine, TextRange, TextRun,
  Tradition, TypesettingOptions, VerticalOrientation,
} from '../types/typesetting'
import { unicodeScript } from './identity'
import verticalData from './verticalOrientation.json'

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
const lineBreaker = new Rules()
const hardBreak = /^[\r\n\v\f\u0085\u2028\u2029]+$/u
const horizontalSpace = /^[\t\p{Zs}]+$/u
const zeroWidth = /^[\u200B\u2060\uFEFF]+$/u
const japaneseNoStart = new Set([...'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿー々〻ヽヾゝゞ'])
const koreanNoStart = new Set([...'·ㆍ、。，！？：；％‰…‥'])
const halfWidthPunctuation = /^[「」『』【】〔〕〈〉《》（）［］｛｝、。，．：；！？]$/u
const requiresBidi = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Bidi_Control}]/u
const compact = /^(?:[0-9]{2,4}|[A-Z]{2}|No\.[0-9])(?=$|[^\p{Script=Latin}0-9])/u
const languages: Record<Tradition, TextLanguage> = { Chinese: 'zh', Japanese: 'ja', Korean: 'ko' }
const traditions: Partial<Record<TextLanguage, Tradition>> = { zh: 'Chinese', ja: 'Japanese', ko: 'Korean' }
const rotations = verticalData.ranges as Array<[number, number, VerticalOrientation]>

export function verticalOrientation(text: string): VerticalOrientation {
  const codepoint = text.codePointAt(0)
  if (codepoint === undefined) return 'R'
  let left = 0
  let right = rotations.length
  while (left < right) {
    const mid = (left + right) >>> 1
    const [start, end, orientation] = rotations[mid]
    if (codepoint < start) right = mid
    else if (codepoint > end) left = mid + 1
    else return orientation
  }
  return 'R'
}

export function segmentText(text: string): TextCluster[] {
  return [...segmenter.segment(text)].map(({ segment, index }) =>
    ({ text: segment, start: index, end: index + segment.length, script: unicodeScript(segment) }))
}

function validateRanges<T extends TextRange>(ranges: T[], bounds: Set<number>): T[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  let end = 0
  for (const item of sorted) {
    if (!bounds.has(item.start) || !bounds.has(item.end) || item.start < end || item.start >= item.end) {
      throw new RangeError('Text ranges must align to non-overlapping grapheme boundaries')
    }
    end = item.end
  }
  return sorted
}

function scriptTradition(script: string | null): Tradition | undefined {
  if (script === 'Hangul') return 'Korean'
  if (script === 'Hiragana' || script === 'Katakana') return 'Japanese'
}

function inferTraditions(clusters: TextCluster[]) {
  const cues: Array<{ tradition: Tradition; index: number } | undefined> = []
  let cue: typeof cues[number]
  for (const step of [1, -1]) {
    cue = undefined
    for (let index = step > 0 ? 0 : clusters.length - 1; clusters[index]; index += step) {
      const { script, text } = clusters[index]
      const strong = scriptTradition(script)
      if (strong) cue = { tradition: strong, index }
      else if (hardBreak.test(text) || horizontalSpace.test(text) || /[。！？!?]/u.test(text)) cue = undefined
      const existing = cues[index]
      if (cue && (!existing || Math.abs(index - cue.index) < Math.abs(index - existing.index))) cues[index] = cue
    }
  }
  return cues
}

function unitAdvance(
  value: string, script: string | null, kind: LayoutUnit['kind'], options: TypesettingOptions,
) {
  if (kind === 'break' || zeroWidth.test(value)) return 0
  if (kind === 'space') return value === '\t' ? 1.32 : value === '　' ? 1 : .33
  if (kind === 'tcy') return 1
  if (options.compressPunctuation && halfWidthPunctuation.test(value)) return .5
  return script === 'Latin' || /^[0-9]$/u.test(value) ? .58 : 1
}

export function layoutUnits(text: string, options: TypesettingOptions): { clusters: TextCluster[]; units: LayoutUnit[] } {
  if (requiresBidi.test(text)) throw new RangeError('Bidirectional scripts and controls require a bidi layout engine')
  const clusters = segmentText(text)
  const bounds = new Set([0, ...clusters.map((cluster) => cluster.end)])
  const spans = validateRanges(options.spans || [], bounds)
  const regions = validateRanges(options.tcy, bounds)
  const originalGroups = new Map(validateRanges(options.originalGroups || [], bounds).map((range) => [range.start, range.end]))
  if (regions.some(({ start, end }) => !/^[A-Za-z0-9.+%/-]{1,8}$/.test(text.slice(start, end)))) {
    throw new RangeError('Tate-chū-yoko accepts one to eight Latin or numeric characters')
  }
  const vertical = options.layout === 'vertical-rtl'
  const cues = options.mixed ? inferTraditions(clusters) : []
  const units: LayoutUnit[] = []
  let spanIndex = 0
  let regionIndex = 0
  for (let index = 0; index < clusters.length; index++) {
    const cluster = clusters[index]
    while (spans[spanIndex] && spans[spanIndex].end <= cluster.start) spanIndex++
    while (regions[regionIndex] && regions[regionIndex].end <= cluster.start) regionIndex++
    const span = spans[spanIndex]?.start <= cluster.start ? spans[spanIndex] : undefined
    const region = regions[regionIndex]
    const previous = clusters[index - 1]?.text || ''
    // Short ASCII looks ahead at the following character so a longer number stays sideways.
    const auto = vertical && options.automaticTcy && !/[\p{Script=Latin}0-9]/u.test(previous)
      ? compact.exec(text.slice(cluster.start, cluster.start + 10))?.[0] : undefined
    const autoEnd = auto ? cluster.start + auto.length : undefined
    const groupEnd = originalGroups.get(cluster.start)
    const end = groupEnd ?? (vertical && region?.start === cluster.start ? region.end : autoEnd)
    const grouped = end !== undefined && bounds.has(end) &&
      (!region || region.start === cluster.start || region.start >= end) &&
      (!spans[spanIndex] || (span ? end <= span.end : end <= spans[spanIndex].start))
    const stop = grouped ? end : cluster.end
    const value = text.slice(cluster.start, stop)
    const kind = grouped ? groupEnd ? 'original-group' : 'tcy' : hardBreak.test(value) ? 'break'
      : horizontalSpace.test(value) || zeroWidth.test(value) ? 'space' : 'glyph'
    const script = kind === 'tcy' ? 'Latin' : cluster.script
    const inferred = scriptTradition(script) || ((script === 'Han' || !script) ? cues[index]?.tradition : undefined)
    const explicitLanguage = span?.language ?? options.language
    const tradition = span?.tradition || (kind === 'original-group' ? 'Japanese' : undefined) ||
      (options.mixed && (inferred || traditions[explicitLanguage])) || options.tradition
    const language = explicitLanguage !== 'und' ? explicitLanguage : script === 'Latin' ? 'en' : languages[tradition]
    const orientation = vertical ? verticalOrientation(value) : 'U'
    const direction = vertical && kind !== 'tcy' && orientation !== 'R' ? 'ttb' : 'ltr'
    units.push({ start: cluster.start, end: stop, script, text: value, kind, direction, orientation,
      language, tradition, advanceEm: kind === 'original-group' ? segmentText(value).length : unitAdvance(value, script, kind, options) })
    if (grouped) while (clusters[index + 1] && clusters[index + 1].start < stop) index++
  }
  return { clusters, units }
}

function legalEndpoints(text: string, units: LayoutUnit[], strict: boolean): Set<number> {
  const allowed = new Set<number>()
  const opportunities = new Set([...lineBreaker.breaks(text)].map((item) => item.position))
  for (const [index, unit] of units.entries()) {
    const next = units[index + 1]
    if (!strict || !next || unit.kind === 'break' || next.kind === 'break') {
      allowed.add(unit.end)
      continue
    }
    if (!opportunities.has(unit.end)) continue
    if (next.tradition === 'Japanese' && japaneseNoStart.has([...next.text][0])) continue
    if (next.tradition === 'Korean' && (koreanNoStart.has([...next.text][0]) ||
        (unit.script === 'Hangul' && next.script === 'Hangul'))) continue
    allowed.add(unit.end)
  }
  return allowed
}

/** Wrap at UAX #14 opportunities with CJK tailoring.
 * Oversized unbreakable items overflow as a unit. */
export function wrapUnits(text: string, units: LayoutUnit[], limitEm: number, strict: boolean): TextLine[] {
  if (!Number.isFinite(limitEm) || limitEm <= 0) throw new RangeError('Invalid line measure')
  const allowed = legalEndpoints(text, units, strict)
  const lines: TextLine[] = []
  let start = 0
  let candidate = 0
  let used = 0
  let committed = 0
  const push = (end: number, width: number) => {
    lines.push({ units: units.slice(start, end), advanceEm: width, overflow: width > limitEm })
    start = end
    candidate = end
    committed = 0
    used = 0
  }
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]
    if (unit.kind === 'break') { push(index + 1, used); continue }
    used += unit.advanceEm
    if (used > limitEm && candidate > start) {
      const end = candidate
      push(end, committed)
      index = end - 1
      continue
    }
    if (allowed.has(unit.end)) {
      candidate = index + 1
      committed = used
      if (used > limitEm) push(candidate, committed)
    }
  }
  if (start < units.length) push(units.length, used)
  else if (units.at(-1)?.kind === 'break') push(units.length, 0)
  return lines
}

export function runsForLine(line: TextLine): TextRun[] {
  const runs: TextRun[] = []
  let current: TextRun | undefined
  for (const unit of line.units) {
    if (unit.kind === 'break') { current = undefined; continue }
    const tcy = unit.kind === 'tcy'
    if (current && !current.tcy && !tcy && current.script === unit.script &&
        current.tradition === unit.tradition && current.language === unit.language &&
        current.direction === unit.direction && current.orientation === unit.orientation) {
      current.text += unit.text
      current.end = unit.end
    } else {
      current = { start: unit.start, end: unit.end, text: unit.text, script: unit.script, language: unit.language,
        tradition: unit.tradition, direction: unit.direction, orientation: unit.orientation, tcy, sequences: [] }
      runs.push(current)
    }
  }
  return runs
}

export function analyzeText(text: string, options: TypesettingOptions, limitEm: number): TextLayout {
  const { clusters, units } = layoutUnits(text, options)
  const lines = wrapUnits(text, units, limitEm, options.kinsoku)
  return { text, clusters, units, lines, runs: lines.flatMap(runsForLine) }
}
