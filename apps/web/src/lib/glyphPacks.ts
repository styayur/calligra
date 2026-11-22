import { uiText } from "../i18n"
import { openScan } from './extraction'
import { sha256 } from './fontShaper'
import { textCharacters } from './identity'
import { validateProject } from './project'
import type { Glyph } from '../types'

export interface GlyphPack {
  id: string
  name: string
  version: string
  enabled: boolean
  count: number
  source: string
}

export interface PackedGlyph extends Glyph {
  packId: string
}

export async function parseGlyphPack(file: File): Promise<{ pack: GlyphPack; glyphs: PackedGlyph[] }> {
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error(uiText("字库分包上限为 32 MiB"))
  const value = JSON.parse(await file.text())
  if (!value || value.schema_version !== 1 || typeof value.id !== 'string' ||
      !/^[a-z][a-z0-9-]{1,47}$/.test(value.id) ||
      typeof value.version !== 'string' || !/^[a-zA-Z0-9._-]{1,32}$/.test(value.version) ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 96 ||
      typeof value.source !== 'string' || !value.source.trim() || value.source.length > 256 ||
      !Array.isArray(value.glyphs) || !value.glyphs.length || value.glyphs.length > 256)
    throw new Error(uiText("无效的字库分包清单"))
  const pack = { id: value.id, name: value.name.trim(), version: value.version, source: value.source.trim(), enabled: true, count: 0 }
  const project = validateProject({
    version: 2,
    canvas: { width: 100, height: 100, background: '#ffffff' },
    glyphs: value.glyphs.map((glyph: Glyph, index: number) => ({ ...glyph, id: String(index), glyph_id: String(index) })),
  })
  const glyphs = new Map<string, PackedGlyph>()
  for (const glyph of project.glyphs) {
    if (glyph.provenance.type !== 'original' || textCharacters(glyph.character).length !== 1 ||
        !glyph.character.trim() || glyph.asset.type !== 'raster' ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(glyph.asset.url) ||
        !/^[0-9a-f]{64}$/.test(glyph.asset.checksum ?? '') ||
        !/^[0-9a-f]{64}$/.test(glyph.source.source_checksum ?? '') ||
        !glyph.source.license?.trim() ||
        (glyph.source.source_uri && !/^https?:\/\//i.test(glyph.source.source_uri)))
      throw new Error(uiText("每个字形需要单字、PNG、来源、授权和校验值"))
    const decoded = atob(glyph.asset.url.split(',')[1])
    const bytes = Uint8Array.from(decoded, (value) => value.charCodeAt(0))
    const hash = await sha256(bytes.buffer)
    if (hash !== glyph.asset.checksum) throw new Error(uiText("字形校验值不一致"))
    const scan = await openScan(new File([bytes], 'glyph.png', { type: 'image/png' }))
    if (scan.canvas.width !== glyph.asset.width || scan.canvas.height !== glyph.asset.height)
      throw new Error(uiText("字形尺寸与清单不一致"))
    const key = JSON.stringify([pack.id, glyph.character, glyph.source.source_checksum, glyph.variant?.id, hash])
    const id = 'pack-' + await sha256(new TextEncoder().encode(key).buffer)
    const { glyph_id: _instance, ...record } = glyph
    glyphs.set(id, {
      ...record, id, packId: pack.id,
      source: { ...record.source, dataset: pack.name, source_collection: pack.source, dataset_version: pack.version },
      metadata: { ...record.metadata, pack_id: pack.id, history_unverified: true },
    })
  }
  return { pack, glyphs: [...glyphs.values()] }
}
