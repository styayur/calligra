import pairs from '../../../../samples/japanese/orthography.json'
import { fontGlyphs } from '../api/fonts'
import { initialCandidates } from '../api/candidates'
import { historicalGlyphs } from '../api/historical'
import type { Glyph, GlyphSource } from '../types'
import { candidateCompatible, traditionLocale, type CandidatePolicy } from './candidatePolicy'
import { loadImage } from './featureCache'
import { sha256 } from './fontShaper'
import { migrateGlyph, variationPairs } from './identity'
import type { TextRange, Tradition } from '../types/typesetting'

export type RestorationKind = 'same-work' | 'same-author' | 'exact-original' | 'coverage' | 'components' | 'variant' | 'loan' | 'editorial'
export interface RestorationSlot extends TextRange {
  text: string
  x: number
  y: number
  size: number
  tradition: Tradition
}
export interface RestorationCandidate {
  glyph: Glyph
  kind: RestorationKind
  source?: string
  automatic: boolean
}
export interface RestorationDecision {
  kind: RestorationKind
  character: string
  glyphId: string
  checksum?: string | null
  confirmed: boolean
  evidence?: string
}
export interface RestorationRecord extends RestorationSlot {
  decisions: RestorationDecision[]
}

// Small editorial descriptions. Each component is rendered from an audited bundled face.
const structures: Record<string, string> = { 炎: '⿱火火', 林: '⿰木木', 明: '⿰日月', 森: '⿱木林', 垚: '⿱土圭', 沝: '⿰水水' }
const uncertain = new Set(['□', '〓', '�'])
export const isLacuna = (text: string) => uncertain.has(text)
const shiji = 'https://zh.wikisource.org/wiki/Page:文淵閣四庫全書_0245冊.djvu/93'

function editorialRelations(text: string, slot: RestorationSlot) {
  const related: { character: string; kind: 'variant' | 'loan'; source: string }[] = []
  if (slot.tradition === 'Japanese') {
    for (const [modern, old] of Object.entries(pairs.pairs)) {
      if (slot.text === modern || slot.text === old)
        related.push({ character: slot.text === modern ? old : modern, kind: 'variant', source: pairs.source_uri })
    }
  }
  if (slot.tradition === 'Chinese' && ['蚤','早'].includes(slot.text) && text.slice(Math.max(0, slot.start - 5), slot.start) === '旦日不可不' &&
      text.slice(slot.end, slot.end + 2) === '自來') {
    related.push({ character: slot.text === '蚤' ? '早' : '蚤', kind: 'loan', source: shiji })
  }
  return related
}
export const hasEditorialRelations = (text: string, slot: RestorationSlot) => editorialRelations(text, slot).length > 0

export const canUseRestoration = (glyph: Glyph) => glyph.source.rights?.redistribution_allowed === true &&
  glyph.source.rights?.derivatives_allowed === true && Boolean(glyph.asset.checksum)

function policyFor(slot: RestorationSlot, policy: CandidatePolicy): CandidatePolicy {
  return { writing_tradition: slot.tradition,
    locale: policy.writing_tradition === slot.tradition && policy.locale || traditionLocale(slot.tradition),
    commercial_only: policy.commercial_only, vertical: policy.vertical, mode: 'strict' }
}

async function components(character: string, policy: CandidatePolicy): Promise<Glyph | undefined> {
  const [operator, ...parts] = [...(structures[character] || '')]
  if (!['⿱','⿰'].includes(operator) || parts.length !== 2) return
  const glyphs = await Promise.all(parts.map(async (part) => {
    const candidates = await fontGlyphs(part, '', '', { ...policy, vertical: false })
    return candidates.find((glyph) => canUseRestoration(glyph) && glyph.source.license === 'OFL-1.1')
  }))
  if (!glyphs.every((glyph): glyph is Glyph => !!glyph)) return
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  const horizontal = operator === '⿰'
  const cells = glyphs.map((glyph, index) => ({
    glyph, x: horizontal ? index * 244 + 12 : 12, y: horizontal ? 12 : index * 244 + 12,
    width: horizontal ? 238 : 488, height: horizontal ? 488 : 238,
  }))
  const sources = []
  for (const cell of cells) {
    const image = await loadImage(cell.glyph.asset.url)
    context.drawImage(image, cell.x, cell.y, cell.width, cell.height)
    sources.push({ id: cell.glyph.id, text: cell.glyph.character, sha256: cell.glyph.asset.checksum,
      source: cell.glyph.source, destination: [cell.x, cell.y, cell.width, cell.height] })
  }
  const url = canvas.toDataURL('image/png')
  const checksum = await sha256(await (await fetch(url)).arrayBuffer())
  return migrateGlyph({
    id: 'ids:' + checksum, character, asset: { url, checksum, type: 'generated', width: size, height: size, bbox: [0, 0, size, size] },
    source: { dataset: 'Calligra IDS composition', writing_tradition: policy.writing_tradition,
      locale: policy.locale, script: 'Han', attribution: [...new Set(sources.map((part) => part.source.attribution || part.source.work))].join(', '),
      license: 'OFL-1.1 (components)',
      rights: { redistribution_allowed: true, derivatives_allowed: true, commercial_use: glyphs.every((g) => g.source.rights?.commercial_use === true) } },
    provenance: { type: 'generated' }, transform: glyphs[0].transform, appearance: glyphs[0].appearance,
    metadata: { ids: structures[character], components: sources, changes: 'Component bitmaps scaled into explicit slots' },
  })
}

export function restorationDecision(candidate: RestorationCandidate, confirmed: boolean): RestorationDecision {
  return { kind: candidate.kind, character: candidate.glyph.character, glyphId: candidate.glyph.id,
    checksum: candidate.glyph.asset.checksum, confirmed, evidence: candidate.source }
}

export async function restorationCandidates(text: string, slot: RestorationSlot, policy: CandidatePolicy,
  anchor?: GlyphSource, manual?: string): Promise<RestorationCandidate[]> {
  const requested = manual || slot.text
  const selection = policyFor(slot, policy)
  const permitted = (glyph: Glyph, identity: string) =>
    glyph.character === identity && canUseRestoration(glyph) && candidateCompatible(glyph, selection)
  const found: RestorationCandidate[] = []
  const tryFonts = async (identity: string) => (await fontGlyphs(identity, '', '', {
    ...selection, allow_font_fallback: true,
  }).catch(() => [])).filter((glyph) => permitted(glyph, identity))
  if (manual) {
    return (await tryFonts(manual)).slice(0, 4).map((glyph) => ({ glyph, kind: 'editorial', automatic: false }))
  }
  if (!isLacuna(requested)) {
    const strictFont = Boolean(policy.font_id && !policy.allow_font_fallback)
    const queries = [
      initialCandidates(requested, 'private', '', 16, undefined, selection),
      initialCandidates(requested, 'original', '', 12, undefined, selection),
      historicalGlyphs(requested, selection),
    ]
    const sources = (await Promise.allSettled(queries)).flatMap((result) =>
      result.status === 'fulfilled' ? Array.isArray(result.value) ? result.value : result.value.items : [])
    const originals = [...new Map(sources.filter((glyph) => glyph.provenance.type === 'original' &&
      permitted(glyph, requested)).map((glyph) => [glyph.id, glyph])).values()]
    const author = anchor?.calligrapher
    for (const glyph of originals) {
      const kind = anchor?.work && (glyph.source.work === anchor.work || glyph.metadata?.edition_of === anchor.work) ? 'same-work'
        : author && anchor?.style && glyph.source.calligrapher === author && glyph.source.style === anchor.style ? 'same-author' : 'exact-original'
      found.push({ glyph, kind, automatic: !strictFont && kind !== 'exact-original', source: glyph.source.source_uri ?? undefined })
    }
    const order: Partial<Record<RestorationKind, number>> = { 'same-work': 0, 'same-author': 1, 'exact-original': 2 }
    found.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))
    const hasVariation = Boolean(variationPairs(requested)?.length)
    if (!found.some((candidate) => candidate.automatic)) {
      if (!hasVariation && slot.tradition === 'Chinese') {
        const glyph = await components(requested, selection).catch(() => undefined)
        if (glyph) found.push({ glyph, kind: 'components', automatic: !strictFont })
      }
      for (const glyph of (await tryFonts(requested)).slice(0, 2))
        if (glyph.metadata?.font_id !== policy.font_id)
          found.push({ glyph, kind: 'coverage', automatic: !strictFont })
    }
    for (const link of editorialRelations(text, slot)) {
      const [glyph] = await tryFonts(link.character)
      if (glyph) found.push({ ...link, glyph, automatic: false })
    }
  }
  return found.slice(0, 20)
}
