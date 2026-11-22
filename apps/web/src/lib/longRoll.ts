import { uiText } from "../i18n"
import type { Glyph } from '../types'
import type { TextRun } from '../types/typesetting'
import { textLines } from './composition'
import { loadImage } from './featureCache'
import type { ArtworkPage } from './hybridPdf'

export interface RollOptions {
  rows: number
  columns: number
  vertical: boolean
  punctuation: boolean
}
export interface RollSlot {
  index: number
  character: string
  row: number
  column: number
  glyph: Glyph | null
  cost: number | null
  start?: number
  end?: number
}
export interface RollPage {
  slots: RollSlot[]
  measured?: boolean
  runs?: TextRun[]
  flowCosts?: number[]
}

export function rollArtwork(page: RollPage, options: RollOptions): ArtworkPage {
  const size = Math.min(704 / options.columns, 980 / options.rows)
  return { width: 800, height: 1100, background: '#ffffff', glyphs: page.slots.flatMap((slot) => {
    if (!slot.glyph) return []
    const glyph = slot.glyph
    if (page.measured) return [glyph]
    const factor = size * .86 / Math.max(glyph.asset.width, glyph.asset.height)
    return [{ ...glyph, transform: {
      x: 48 + (slot.column + .5) * 704 / options.columns,
      y: 50 + (slot.row + .5) * 980 / options.rows,
      scaleX: factor, scaleY: factor, rotation: 0, skewX: 0, skewY: 0,
    } }]
  }) }
}
export function paginateRoll(text: string, options: RollOptions): RollPage[] {
  const { rows, columns, vertical } = options
  if (![rows, columns].every((v) => Number.isInteger(v) && v >= 2 && v <= 24))
    throw new Error(uiText("每页行列数须为 2–24"))
  const lines = textLines(text, options.punctuation),
    count = lines.reduce((s, l) => s + l.length, 0)
  if (!count || count > 20000) throw new Error(uiText("长卷支持 1–20000 字"))
  const along = vertical ? rows : columns,
    across = vertical ? columns : rows
  const pages: RollPage[] = []
  let page: RollPage = { slots: [] },
    track = 0,
    index = 0
  for (const line of lines)
    for (let start = 0; start < line.length; start += along) {
      if (track === across) {
        pages.push(page)
        page = { slots: [] }
        track = 0
      }
      line.slice(start, start + along).forEach((character, pos) =>
        page.slots.push({
          index: index++,
          character,
          row: vertical ? pos : track,
          column: vertical ? columns - track - 1 : pos,
          glyph: null,
          cost: null,
        }),
      )
      track++
    }
  if (page.slots.length) pages.push(page)
  return pages
}
export async function renderRollPage(
  page: RollPage,
  options: RollOptions,
  canvas: HTMLCanvasElement,
  scale = 1,
  signal?: AbortSignal,
) {
  canvas.width = 800 * scale
  canvas.height = 1100 * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 800, 1100)
  const images = new Map<string, HTMLImageElement>()
  for (const g of rollArtwork(page, options).glyphs) {
    signal?.throwIfAborted()
    if (!images.has(g.asset.url)) images.set(g.asset.url, await loadImage(g.asset.url))
    signal?.throwIfAborted()
    const image = images.get(g.asset.url)!
    const transform = g.transform
    ctx.save()
    ctx.translate(transform.x, transform.y)
    ctx.rotate(transform.rotation * Math.PI / 180)
    ctx.scale(transform.scaleX, transform.scaleY)
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
    ctx.restore()
  }
}

/** Store-only ZIP: no additional runtime dependency, UTF-8 filenames, CRC32. */
export function zipFiles(files: { name: string; data: Uint8Array }[]): Blob {
  const encoder = new TextEncoder(),
    parts: BlobPart[] = [],
    central: BlobPart[] = []
  let offset = 0,
    centralSize = 0
  const crc = (data: Uint8Array) => {
    let c = 0xffffffff
    for (const b of data) {
      c ^= b
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
    }
    return (c ^ 0xffffffff) >>> 0
  }
  for (const file of files) {
    const name = encoder.encode(file.name),
      checksum = crc(file.data),
      local = new Uint8Array(30 + name.length),
      v = new DataView(local.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 0x800, true)
    v.setUint32(14, checksum, true)
    v.setUint32(18, file.data.length, true)
    v.setUint32(22, file.data.length, true)
    v.setUint16(26, name.length, true)
    local.set(name, 30)
    // Blob parts require an ArrayBuffer-backed view, including when a caller
    // supplied a SharedArrayBuffer view. Copy exactly the selected bytes.
    parts.push(local, Uint8Array.from(file.data))
    const entry = new Uint8Array(46 + name.length),
      e = new DataView(entry.buffer)
    e.setUint32(0, 0x02014b50, true)
    e.setUint16(4, 20, true)
    e.setUint16(6, 20, true)
    e.setUint16(8, 0x800, true)
    e.setUint32(16, checksum, true)
    e.setUint32(20, file.data.length, true)
    e.setUint32(24, file.data.length, true)
    e.setUint16(28, name.length, true)
    e.setUint32(42, offset, true)
    entry.set(name, 46)
    central.push(entry)
    centralSize += entry.length
    offset += local.length + file.data.length
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, files.length, true)
  e.setUint16(10, files.length, true)
  e.setUint32(12, centralSize, true)
  e.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end], { type: 'application/zip' })
}
