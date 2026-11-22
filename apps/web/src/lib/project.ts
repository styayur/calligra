import { uiText } from "../i18n"
import type { ProjectDocument } from '../types'
import { validLayoutDimensions } from './composition'
import { codepoints, migrateGlyph, textCharacters } from './identity'

function checkTypography(text: string, settings: NonNullable<ProjectDocument['composition']>) {
  const typography = settings.typography
  if (!typography) return settings.shapedRuns === undefined && settings.flowCosts === undefined
  if (typeof typography !== 'object' ||
      !(['mixed', 'kinsoku', 'compressPunctuation', 'automaticTcy', 'discretionary'] as const)
        .every((key) => typeof typography[key] === 'boolean') ||
      !Array.isArray(typography.tcy) || typography.tcy.length > 1000 ||
      (typography.connectedKana !== undefined && typeof typography.connectedKana !== 'boolean') ||
      (typography.spans !== undefined && (!Array.isArray(typography.spans) || typography.spans.length > 1000))) return false
  const boundaries = new Set([0])
  let index = 0
  for (const cluster of textCharacters(text)) { index += cluster.length; boundaries.add(index) }
  const range = (record: { start: number; end: number } | null | undefined) =>
    record && boundaries.has(record.start) && boundaries.has(record.end) && record.start < record.end
  const flow = typography.flow
  if (flow !== undefined && (!flow || !['natural', 'fluent'].includes(flow.mode) ||
    !Number.isFinite(flow.intensity) || flow.intensity < 0 || flow.intensity > 1 ||
    !Array.isArray(flow.pins) || flow.pins.length > 1000 ||
    !flow.pins.every((pin) => range(pin) && typeof pin.glyphId === 'string' && pin.glyphId.length <= 256))) return false
  if (!typography.tcy.every((item) => range(item) && /^[A-Za-z0-9.+%/-]{1,8}$/.test(text.slice(item.start, item.end)))) return false
  if (typography.spans && !typography.spans.every((item) => range(item) &&
    (item.language === undefined || ['und', 'zh', 'ja', 'ko', 'en'].includes(item.language)) &&
    (item.tradition === undefined || ['Chinese', 'Japanese', 'Korean'].includes(item.tradition)))) return false
  const runs = settings.shapedRuns
  const costs = settings.flowCosts
  if (costs !== undefined && (!Array.isArray(costs) || costs.length > 1000 ||
    !costs.every((cost) => Number.isFinite(cost) && cost >= 0))) return false
  if (runs === undefined) return true
  return Array.isArray(runs) && runs.length <= 1000 && runs.every((run) => range(run) &&
    run.text === text.slice(run.start, run.end) && ['ltr', 'ttb'].includes(run.direction) &&
    ['U', 'R', 'Tu', 'Tr'].includes(run.orientation) &&
    Array.isArray(run.sequences) && run.sequences.length <= 1000 &&
    run.sequences.every((sequence) => range(sequence) && sequence.start >= run.start && sequence.end <= run.end &&
      sequence.text === text.slice(sequence.start, sequence.end) && typeof sequence.fontId === 'string' &&
      Array.isArray(sequence.positions) && sequence.positions.length <= 5000 &&
      sequence.positions.every((glyph) => glyph && Number.isInteger(glyph.id) && glyph.id > 0 &&
        boundaries.has(glyph.cluster) && glyph.cluster >= sequence.start && glyph.cluster < sequence.end &&
        [glyph.x, glyph.y, glyph.advanceX, glyph.advanceY, glyph.width, glyph.height, glyph.rotation]
          .every((metric) => Number.isFinite(metric) && Math.abs(metric) < 5000))))
}

export function validateProject(value: unknown): ProjectDocument {
  const p = value as ProjectDocument
  if (!p || ![1,2].includes(p.version) || !p.canvas || !Array.isArray(p.glyphs))
    throw new Error(uiText("请选择有效的集字项目文件"))
  const { width, height, background } = p.canvas
  if (
    ![width, height].every((n) => Number.isFinite(n) && n >= 100 && n <= 8000) ||
    width * height > 20_000_000 ||
    !/^#[\da-f]{6}$/i.test(background)
  )
    throw new Error(uiText("项目纸面尺寸或颜色无效"))
  if (p.glyphs.length > 1000) throw new Error(uiText("项目字形过多，最多载入 1000 字"))
  if (p.text !== undefined && typeof p.text !== 'string') throw new Error(uiText("项目文字无效"))
  const decided = new Map<string, NonNullable<ProjectDocument['restorations']>[number]['decisions'][number]>()
  if (p.restorations !== undefined) {
    const slots = new Set<string>()
    if (!Array.isArray(p.restorations) || p.restorations.length > 1000 ||
      !p.restorations.every((entry) => {
        if (!entry || !Number.isInteger(entry.start) || !Number.isInteger(entry.end) || entry.start < 0 ||
          entry.end <= entry.start || typeof entry.text !== 'string' || entry.text.length > 64 ||
          entry.text !== p.text?.slice(entry.start, entry.end) ||
          !['Chinese','Japanese','Korean'].includes(entry.tradition) ||
          ![entry.x, entry.y, entry.size].every((n) => Number.isFinite(n) && Math.abs(n) <= 16000) || entry.size <= 0 ||
          !Array.isArray(entry.decisions) || entry.decisions.length > 1000) return false
        const key = `${entry.start}:${entry.end}`
        if (slots.has(key)) return false
        slots.add(key)
        if (!entry.decisions.every((decision) => decision &&
            ['same-work','same-author','exact-original','coverage','components','variant','loan','editorial'].includes(decision.kind) &&
            typeof decision.glyphId === 'string' && decision.glyphId.length <= 256 &&
            typeof decision.character === 'string' && decision.character.length > 0 && decision.character.length <= 64 &&
            typeof decision.confirmed === 'boolean' &&
            (decision.confirmed || entry.text === decision.character && !['variant','loan','editorial'].includes(decision.kind)) &&
            (decision.evidence === undefined || typeof decision.evidence === 'string' && decision.evidence.length <= 2048) &&
            (decision.checksum == null || /^[a-f0-9]{64}$/i.test(decision.checksum)))) return false
        const last = entry.decisions.at(-1)
        if (last) decided.set(key, last)
        return true
      })) throw new Error(uiText('项目补字记录无效'))
  }
  if (p.composition) {
    const c = p.composition
    if (
      !['grid', 'horizontal-ltr', 'vertical-rtl'].includes(c.layout) ||
      !['fonts', 'original', 'all', 'fallback', 'private'].includes(c.source) ||
      typeof c.style !== 'string' ||
      typeof c.punctuation !== 'boolean' ||
      (c.textLanguage !== undefined && !['und', 'zh', 'ja', 'ko', 'en'].includes(c.textLanguage)) ||
      !checkTypography(p.text || '', c) ||
      !validLayoutDimensions(c)
    )
      throw new Error(uiText("项目排版参数无效"))
    if (c.policy) {
      const policy=c.policy
      if (typeof policy !== 'object' || Array.isArray(policy) ||
        !['writing_tradition','language','locale','script','variant_type','orthography','period','work','designer','dataset','provenance_type'].every((key) => {const value=policy[key as keyof typeof policy]; return value == null || (typeof value === 'string' && value.length <= 1000)}) ||
        (policy.mode != null && !['strict','related','cross-tradition'].includes(policy.mode)) ||
        (policy.commercial_only != null && typeof policy.commercial_only !== 'boolean') ||
        (policy.font_id !== undefined && (typeof policy.font_id !== 'string' ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(policy.font_id) || policy.font_id.length > 80)) ||
        (policy.allow_font_fallback !== undefined && typeof policy.allow_font_fallback !== 'boolean') ||
        (policy.smart_mix !== undefined && typeof policy.smart_mix !== 'boolean') ||
        (policy.vertical != null && typeof policy.vertical !== 'boolean')) throw new Error(uiText("项目选择规则无效"))
    }
  }
  const ids = new Set<string>()
  for (const g of p.glyphs) {
    if (g?.identity && (g.identity.text !== g.character || JSON.stringify(g.identity.codepoints) !== JSON.stringify(codepoints(g.character)))) throw new Error(uiText("项目 Unicode 身份无效"))
    if (
      !g ||
      typeof g.id !== 'string' ||
      ids.has(g.id) ||
      typeof g.character !== 'string' ||
      g.character.length < 1 || g.character.length > 64 ||
      !g.source ||
      !g.asset ||
      !g.transform ||
      !g.appearance ||
      !g.provenance ||
      typeof g.glyph_id !== 'string'
    )
      throw new Error(uiText("项目包含无效字形"))
    ids.add(g.id)
    const restored = g.textRange && decided.get(`${g.textRange.start}:${g.textRange.end}`)
    if (g.textRange !== undefined &&
      (!g.textRange || !Number.isInteger(g.textRange.start) || !Number.isInteger(g.textRange.end) ||
        g.textRange.start < 0 || g.textRange.end <= g.textRange.start ||
        (p.text?.slice(g.textRange.start, g.textRange.end) !== g.character &&
          !(restored?.confirmed && restored.glyphId === g.glyph_id && restored.character === g.character &&
            restored.checksum === g.asset.checksum))))
      throw new Error(uiText("项目 Unicode 身份无效"))
    if (
      typeof g.source.dataset !== 'string' ||
      !['calligrapher', 'style', 'dynasty', 'work', 'license', 'license_url','language','locale','script','writing_tradition','orthography','period','region','source_collection','source_uri','attribution','designer','dataset_version','source_checksum','license_text'].every((key) => {
        const value = g.source[key as keyof typeof g.source]
        return value == null || typeof value === 'string'
      }) ||
      (g.source.source_role !== undefined && g.source.source_role !== null && !['calligraphy','handwriting','historical-original','coverage-fallback'].includes(g.source.source_role)) ||
      !['font', 'original', 'fallback', 'generated'].includes(g.provenance.type)
    )
      throw new Error(uiText("项目字形来源无效"))
    if (g.variant && (
      (g.variant.type != null && !['modern','traditional','simplified','shinjitai','kyujitai','hentaigana','historical','regional','font-alternate'].includes(g.variant.type)) ||
      !['id','glyph_name'].every((key) => { const v=g.variant![key as 'id' | 'glyph_name']; return v == null || (typeof v === 'string' && v.length <= 256) }) ||
      (g.variant.font_glyph_id != null && (!Number.isInteger(g.variant.font_glyph_id) || g.variant.font_glyph_id < 0))
    )) throw new Error(uiText("项目字形变体无效"))
    if (
      !['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten'].includes(
        g.appearance.blendMode,
      )
    )
      throw new Error(uiText("项目混合模式无效"))
    if (
      typeof g.asset.url !== 'string' ||
      !/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/|(?:\.\/|\/)?(?:[\w.-]+\/)*(?:demo|assets)\/)/i.test(
        g.asset.url,
      )
    )
      throw new Error(uiText("项目包含不支持的图片地址"))
    if (
      ![g.asset.width, g.asset.height].every((n) => Number.isFinite(n) && n > 0 && n <= 16000) ||
      !['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY'].every((key) =>
        Number.isFinite(g.transform[key as keyof typeof g.transform]),
      ) ||
      !Number.isFinite(g.appearance.opacity) ||
      g.appearance.opacity < 0 ||
      g.appearance.opacity > 1
    )
      throw new Error(uiText("项目字形参数无效"))
  }
  return { ...p, version: 2, glyphs: p.glyphs.map(migrateGlyph) }
}

export interface Draft {
  name: string
  document: ProjectDocument
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('calligraphy-studio', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function readDraft(): Promise<Draft | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts')
    const request = transaction.objectStore('drafts').get('current')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
  })
}
export async function writeDraft(draft: Draft): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite')
    transaction.objectStore('drafts').put(draft, 'current')
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error)
    }
  })
}
