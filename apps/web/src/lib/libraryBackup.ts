import { uiText } from "../i18n"
import { sha256 } from './fontShaper'
import type { Glyph, GlyphInstance } from '../types'
import type { GlyphPack, PackedGlyph } from './glyphPacks'
import { restoreLibrary, snapshotLibrary, PRIVATE_DATASET, type LibraryContents } from './privateLibrary'
import { validateProject } from './project'

const LIMIT = 192 * 1024 * 1024
const HASH = /^[0-9a-f]{64}$/
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
const MAX_ROWS = 20_000

interface ScanReceipt {
  checksum: string
  name: string
  type: string
  lastModified: number
  bytes: string
}
interface LibraryBackup extends Omit<LibraryContents, 'scans'> {
  kind: 'calligra-private-library'
  schema_version: 1
  scans: ScanReceipt[]
}

function invalid(): never {
  throw new Error(uiText("个人字库备份结构、校验值或引用无效。"))
}
function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
function fromBase64(encoded: string, limit: number): Uint8Array<ArrayBuffer> {
  if (!encoded || encoded.length > Math.ceil(limit / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4) invalid()
  const text = atob(encoded)
  if (text.length > limit) invalid()
  return Uint8Array.from(text, (character) => character.charCodeAt(0))
}

export async function exportLibraryBackup(): Promise<Blob> {
  const snapshot = await snapshotLibrary()
  const scans: ScanReceipt[] = []
  const storedSize = snapshot.scans.reduce((total, { file }) => total + Math.ceil(file.size / 3) * 4, 0)
  if (storedSize > LIMIT) throw new Error(uiText("个人字库备份超过 192 MiB。"))
  for (const { checksum, file } of snapshot.scans) {
    scans.push({ checksum, name: file instanceof File ? file.name : checksum,
      type: file.type, lastModified: file instanceof File ? file.lastModified : 0,
      bytes: await toBase64(file) })
  }
  const backup: LibraryBackup = { kind: 'calligra-private-library', schema_version: 1, ...snapshot, scans }
  const result = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  if (result.size > LIMIT) throw new Error(uiText("个人字库备份超过 192 MiB。"))
  return result
}

export async function importLibraryBackup(file: File): Promise<number> {
  if (!file.size || file.size > LIMIT) throw new Error(uiText("个人字库备份上限为 192 MiB。"))
  const value = JSON.parse(await file.text()) as LibraryBackup
  if (!value || value.kind !== 'calligra-private-library' || value.schema_version !== 1 ||
      ![value.glyphs, value.scans, value.packs, value.packedGlyphs].every((rows) => Array.isArray(rows) && rows.length <= MAX_ROWS))
    invalid()

  const scans = new Map<string, Blob>()
  for (const scan of value.scans) {
    if (!scan || typeof scan.checksum !== 'string' || !HASH.test(scan.checksum) || scans.has(scan.checksum) ||
        typeof scan.bytes !== 'string' || typeof scan.name !== 'string' || scan.name.length > 512 ||
        typeof scan.type !== 'string' || (scan.type && !/^image\/([-a-z0-9+.]+)$/i.test(scan.type)) ||
        !Number.isSafeInteger(scan.lastModified) || scan.lastModified < 0) invalid()
    const bytes = fromBase64(scan.bytes, 32 * 1024 * 1024)
    if (await sha256(bytes.buffer) !== scan.checksum) invalid()
    scans.set(scan.checksum, new File([bytes], scan.name, { type: scan.type, lastModified: scan.lastModified }))
  }
  const packs = new Map<string, GlyphPack>()
  const names = new Set([PRIVATE_DATASET])
  const counts = new Map<string, number>()
  for (const pack of value.packs) {
    if (!pack || typeof pack.id !== 'string' || !/^[a-z][a-z0-9-]{1,47}$/.test(pack.id) || packs.has(pack.id) ||
        typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 96 || names.has(pack.name) ||
        typeof pack.version !== 'string' || !/^[a-zA-Z0-9._-]{1,32}$/.test(pack.version) ||
        typeof pack.source !== 'string' || !pack.source.trim() || pack.source.length > 256 ||
        !Number.isSafeInteger(pack.count) || pack.count < 1 || typeof pack.enabled !== 'boolean') invalid()
    packs.set(pack.id, pack)
    names.add(pack.name)
  }

  const ids = new Set<string>()
  async function validateGlyph<T extends Glyph>(record: T): Promise<T> {
    if (!record || typeof record.id !== 'string' || ids.has(record.id) ||
        !record.asset || record.asset.type !== 'raster' || typeof record.asset.url !== 'string' ||
        !PNG.test(record.asset.url) || !HASH.test(record.asset.checksum ?? '') ||
        !HASH.test(record.source?.source_checksum ?? '') || record.provenance?.type !== 'original') invalid()
    const bytes = fromBase64(record.asset.url.slice('data:image/png;base64,'.length), 32 * 1024 * 1024)
    if (await sha256(bytes.buffer) !== record.asset.checksum) invalid()
    const png = new DataView(bytes.buffer)
    if (png.byteLength < 24 || png.getUint32(0) !== 0x89504e47 || png.getUint32(4) !== 0x0d0a1a0a ||
        png.getUint32(16) !== record.asset.width || png.getUint32(20) !== record.asset.height) invalid()
    const project = validateProject({ version: 2, canvas: { width: 100, height: 100, background: '#ffffff' },
      glyphs: [{ ...record, glyph_id: record.id } satisfies GlyphInstance] })
    ids.add(record.id)
    const { glyph_id: _instance, ...glyph } = project.glyphs[0]
    return glyph as T
  }

  const glyphs = []
  for (const record of value.glyphs) {
    const glyph = await validateGlyph(record)
    if (!/^private-[0-9a-f]{64}$/.test(glyph.id) || glyph.source.dataset !== PRIVATE_DATASET ||
        !scans.has(glyph.source.source_checksum!)) invalid()
    glyphs.push(glyph)
  }
  const packedGlyphs: PackedGlyph[] = []
  for (const record of value.packedGlyphs) {
    const glyph = await validateGlyph(record)
    const pack = packs.get(glyph.packId)
    if (!/^pack-[0-9a-f]{64}$/.test(glyph.id) || !pack || glyph.source.dataset !== pack.name ||
        glyph.source.source_collection !== pack.source || glyph.source.dataset_version !== pack.version ||
        !glyph.source.license) invalid()
    packedGlyphs.push(glyph)
    counts.set(pack.id, (counts.get(pack.id) ?? 0) + 1)
  }
  for (const pack of packs.values()) if (pack.count !== counts.get(pack.id)) invalid()
  await restoreLibrary({ glyphs, packs: [...packs.values()], packedGlyphs,
    scans: [...scans].map(([checksum, file]) => ({ checksum, file })) })
  return glyphs.length + packedGlyphs.length
}
