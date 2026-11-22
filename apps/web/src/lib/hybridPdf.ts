import { fontCatalog } from '../api/fonts'
import { uiText } from '../i18n'
import { zlibSync } from 'fflate'
import type { Glyph } from '../types'
import { imageDimensions } from './extraction'
import { artworkOutlines, sha256 } from './fontShaper'
import { attributionFiles, type ExportPolicy } from './rights'

export interface ArtworkPage {
  width: number
  height: number
  background: string
  glyphs: Glyph[]
}
export interface PdfOptions extends ExportPolicy {
  paper: 'artwork' | 'a4' | 'a3' | 'custom'
  preset: 'reading' | 'print' | 'archive'
  transparent?: boolean
  widthMm?: number
  heightMm?: number
  signal?: AbortSignal
  progress?: (page: number, total: number) => void
  originalText?: string
  restoration?: unknown
}
const encode = new TextEncoder()
const number = (value: number) => {
  if (!Number.isFinite(value) || Math.abs(value) > 1e8) throw new Error('Invalid PDF artwork coordinate')
  return Number(value.toFixed(5)).toString()
}
const row = (...values: number[]) => values.map(number).join(' ')
const hex = (text: string) => Array.from({ length: text.length }, (_, index) =>
  text.charCodeAt(index).toString(16).padStart(4, '0')).join('').toUpperCase()

/** PDF objects and byte offsets are built separately, including binary image streams. */
class PdfFile {
  private objects: Uint8Array<ArrayBuffer>[][] = []
  private size = 0
  reserve() { return this.objects.push([]) }
  set(id: number, ...parts: (string | Uint8Array<ArrayBuffer>)[]) {
    const bytes = parts.map((part) => typeof part === 'string' ? encode.encode(part) : part)
    this.size += bytes.reduce((sum, part) => sum + part.byteLength, 0)
    if (this.size > 128 * 1024 * 1024) throw new Error('PDF exceeds 128 MiB. Export the long scroll in sections.')
    this.objects[id - 1] = bytes
  }
  add(...parts: (string | Uint8Array<ArrayBuffer>)[]) {
    const id = this.reserve()
    this.set(id, ...parts)
    return id
  }
  stream(dict: string, data: string | Uint8Array<ArrayBuffer>) {
    const bytes = typeof data === 'string' ? encode.encode(data) : data
    return this.add(`<< ${dict} /Length ${bytes.byteLength} >>\nstream\n`, bytes, '\nendstream')
  }
  finish(root: number, info: number) {
    const header = encode.encode('%PDF-1.7\n%âãÏÓ\n')
    const parts: BlobPart[] = [header]
    let offset = header.byteLength
    const xref = ['0000000000 65535 f \n']
    for (const [index, body] of this.objects.entries()) {
      if (!body.length) throw new Error('Unwritten PDF object')
      const start = encode.encode(`${index + 1} 0 obj\n`)
      const stop = encode.encode('\nendobj\n')
      xref.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
      parts.push(start, ...body, stop)
      offset += start.byteLength + stop.byteLength + body.reduce((sum, part) => sum + part.byteLength, 0)
    }
    parts.push(`xref\n0 ${xref.length}\n${xref.join('')}trailer\n<< /Size ${xref.length} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`)
    return new Blob(parts, { type: 'application/pdf' })
  }
}

/** HarfBuzz exposes absolute SVG M/L/Q/C/Z operations. Convert quadratic curves exactly. */
function outlineOperators(path: string) {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)/g) || []
  const commands: string[] = []
  let x = 0, y = 0
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++]
    if (command === 'Z') { commands.push('h'); continue }
    const count = { M: 2, L: 2, Q: 4, C: 6 }[command as 'M' | 'L' | 'Q' | 'C']
    if (!count || index + count > tokens.length) throw new Error('Unsupported OpenType outline operation')
    const points = tokens.slice(index, index + count).map(Number)
    index += count
    if (command === 'Q') {
      const [cx, cy, endX, endY] = points
      commands.push(row(x + (cx - x) * 2 / 3, y + (cy - y) * 2 / 3,
        endX + (cx - endX) * 2 / 3, endY + (cy - endY) * 2 / 3, endX, endY) + ' c')
    } else commands.push(row(...points) + ({ M: ' m', L: ' l', C: ' c' }[command] || ''))
    x = points[count - 2]
    y = points[count - 1]
  }
  return commands.join('\n')
}

function textFont(pdf: PdfFile, characters: string[], emptyGlyph: number) {
  const groups = []
  for (let start = 0; start < characters.length; start += 240) {
    const group = characters.slice(start, start + 240)
    const codes = group.map((_, i) => (i + 1).toString(16).padStart(2, '0'))
    const mappings = []
    for (let offset = 0; offset < group.length; offset += 80) {
      const slice = group.slice(offset, offset + 80)
      mappings.push(`${slice.length} beginbfchar\n${slice.map((text, i) =>
        `<${codes[offset + i]}> <${hex(text)}>`).join('\n')}\nendbfchar`)
    }
    const cmap = pdf.stream('', [
      '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
      '/CIDSystemInfo << /Registry (Calligra) /Ordering (Unicode) /Supplement 0 >> def',
      '/CMapName /CalligraUnicode def', '/CMapType 2 def', '1 begincodespacerange\n<01> <FF>\nendcodespacerange',
      ...mappings, 'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end',
    ].join('\n'))
    const names = codes.map((code) => '/g' + code)
    groups.push(pdf.add(`<< /Type /Font /Subtype /Type3 /FontBBox [0 -200 1000 850]
      /FontMatrix [.001 0 0 .001 0 0] /Resources << >> /CharProcs << ${names.map((name) =>
        `${name} ${emptyGlyph} 0 R`).join(' ')} >> /Encoding << /Type /Encoding /Differences [1 ${names.join(' ')}] >>
      /FirstChar 1 /LastChar ${group.length} /Widths [${group.map(() => '1000').join(' ')}] /ToUnicode ${cmap} 0 R >>`))
  }
  return groups
}

function paper(page: ArtworkPage, options: PdfOptions) {
  if (options.paper === 'artwork') return { width: page.width * .75, height: page.height * .75, scale: .75, x: 0, y: 0 }
  const mm = 72 / 25.4
  let [w, h] = options.paper === 'a4' ? [210, 297] : options.paper === 'a3' ? [297, 420]
    : [options.widthMm ?? 210, options.heightMm ?? 297]
  if (options.paper !== 'custom' && page.width > page.height) [w, h] = [h, w]
  if (![w,h].every((value) => Number.isFinite(value) && value >= 20 && value <= 2000)) throw new Error('Invalid paper size')
  const width = w * mm, height = h * mm
  const margin = (options.preset === 'print' ? 12 : options.preset === 'archive' ? 8 : 4) * mm
  const scale = Math.min((width - 2 * margin) / page.width, (height - 2 * margin) / page.height)
  if (!(scale > 0)) throw new Error('Paper is smaller than the selected margins')
  return { width, height, scale, x: (width - page.width * scale) / 2, y: (height - page.height * scale) / 2 }
}

async function deflate(data: Uint8Array<ArrayBuffer>) {
  if (typeof CompressionStream === 'undefined') return Uint8Array.from(zlibSync(data))
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function artworkImage(pdf: PdfFile, glyph: Glyph, signal?: AbortSignal) {
  const url = new URL(glyph.asset.url, location.href)
  const embedded = /^data:image\/(?:png|jpeg|webp);base64,/.test(url.href)
  const local = url.origin === location.origin && !url.search && !url.hash &&
    /\/(?:demo|japanese)\/assets\/[\w./-]+\.(?:png|jpg|jpeg|webp|svg)$/i.test(url.pathname)
  if (!embedded && !local) throw new Error('PDF images must be embedded or from the bundled library')
  const response = await fetch(url, { signal, redirect: 'error' })
  if (!response.ok) throw new Error('Glyph image could not be loaded')
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('PDF image exceeds 20 MiB')
  if (glyph.asset.checksum && await sha256(bytes) !== glyph.asset.checksum) throw new Error('Glyph checksum mismatch')
  const bundledSvg = local && url.pathname.endsWith('.svg')
  const dimensions = imageDimensions(new Uint8Array(bytes))
  if (!bundledSvg && (!dimensions || !dimensions.every((value) => value > 0 && value <= 8192) ||
      dimensions[0] * dimensions[1] > 16_000_000)) throw new Error(uiText('PDF 裁片尺寸或格式超出限制'))
  const blob = new Blob([bytes], { type: bundledSvg ? 'image/svg+xml' : response.headers.get('content-type') || 'image/png' })
  const image = await createImageBitmap(blob)
  try {
    signal?.throwIfAborted()
    const { width, height } = image
    if (width * height > 16_000_000) throw new Error('PDF glyph exceeds 16 million pixels')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, width, height)
    canvas.width = canvas.height = 0
    const rgb = new Uint8Array(width * height * 3), alpha = new Uint8Array(width * height)
    let hasAlpha = false
    for (let i = 0; i < alpha.length; i++) {
      rgb[i * 3] = data[i * 4]
      rgb[i * 3 + 1] = data[i * 4 + 1]
      rgb[i * 3 + 2] = data[i * 4 + 2]
      alpha[i] = data[i * 4 + 3]
      hasAlpha ||= alpha[i] !== 255
    }
    const common = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8 /Filter /FlateDecode`
    const compressed = await deflate(rgb)
    const softMask = hasAlpha ? pdf.stream(common + ' /ColorSpace /DeviceGray', await deflate(alpha)) : undefined
    signal?.throwIfAborted()
    return { ref: pdf.stream(common + ' /ColorSpace /DeviceRGB' + (softMask ? ` /SMask ${softMask} 0 R` : ''), compressed),
      width, height }
  } finally {
    image.close()
  }
}

export async function buildHybridPdf(pages: ArtworkPage[], options: PdfOptions) {
  if (!pages.length || pages.length > 1000) throw new Error('PDF supports 1–1000 pages per export')
  options.signal?.throwIfAborted()
  const all = pages.flatMap((page) => page.glyphs)
  if (all.length > 20_000) throw new Error('PDF supports up to 20,000 positioned glyphs')
  const files = await attributionFiles(all, options)
  const catalog = new Map((await fontCatalog()).map((font) => [font.id, font]))
  const pdf = new PdfFile()
  const pageTree = pdf.reserve()
  const pageIds = [], rasters = new Map<string, Awaited<ReturnType<typeof artworkImage>>>()
  const vectorCache = new Map<string, number | null>()
  const statistics = { vector: 0, raster: 0, minimumDpi: null as number | null, pages: pages.length }
  const emptyGlyph = pdf.stream('', '1000 0 0 -200 1000 850 d1')
  for (const [index, page] of pages.entries()) {
    options.signal?.throwIfAborted()
    if (![page.width, page.height].every((dim) => Number.isFinite(dim) && dim > 0 && dim <= 16000)) throw new Error('Invalid artwork dimensions')
    const media = paper(page, options)
    const characters = [...new Set(page.glyphs.map((glyph) => glyph.character))]
    const characterIndices = new Map(characters.map((character, i) => [character, i]))
    const fonts = textFont(pdf, characters, emptyGlyph)
    const resources = new Map<number, string>(), states = new Map<string, number>()
    const content: string[] = [], textLayer: string[] = []
    const bg = /^#[0-9a-fA-F]{6}$/.test(page.background) ? page.background : '#ffffff'
    const rgb = bg.slice(1).match(/../g)!.map((value) => parseInt(value, 16) / 255)
    content.push('q', row(media.scale, 0, 0, -media.scale, media.x, media.height - media.y) + ' cm')
    if (!options.transparent) content.push(row(...rgb) + ' rg', row(0, 0, page.width, page.height) + ' re f')
    for (const glyph of page.glyphs) {
      options.signal?.throwIfAborted()
      const transform = glyph.transform
      const angle = transform.rotation * Math.PI / 180
      const cos = Math.cos(angle), sin = Math.sin(angle)
      const blend = { multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten' }[glyph.appearance.blendMode] || 'Normal'
      const state = `/ca ${number(glyph.appearance.opacity)} /BM /${blend}`
      if (!states.has(state)) states.set(state, pdf.add(`<< /Type /ExtGState ${state} >>`))
      const key = glyph.asset.checksum || glyph.asset.url
      const entry = glyph.provenance.type === 'font' && typeof glyph.metadata?.font_id === 'string'
        ? catalog.get(glyph.metadata.font_id) : undefined
      const vectorKey = entry && JSON.stringify([entry.id, key])
      if (entry && vectorKey && !vectorCache.has(vectorKey)) {
        const paths = await artworkOutlines({ ...entry, ...entry.opentype }, glyph)
        const vector = paths?.filter((item) => item.path).map((item) =>
          `q ${row(item.scale, 0, 0, -item.scale, item.x, item.y)} cm\n${outlineOperators(item.path)}\nf Q`).join('\n')
        vectorCache.set(vectorKey, vector ? pdf.stream(`/Type /XObject /Subtype /Form /BBox [0 0 ${row(glyph.asset.width, glyph.asset.height)}]`,
          '.09 .106 .102 rg\n' + vector) : null)
      }
      const vectorRef = vectorKey ? vectorCache.get(vectorKey) : null
      let image: Awaited<ReturnType<typeof artworkImage>> | undefined
      if (!vectorRef) {
        if (!rasters.has(key)) rasters.set(key, await artworkImage(pdf, glyph, options.signal))
        image = rasters.get(key)!
        const dpi = 72 / (media.scale * Math.max(Math.hypot(transform.scaleX, transform.skewY * transform.scaleX),
          Math.hypot(transform.scaleY, transform.skewX * transform.scaleY)))
        if (Number.isFinite(dpi)) statistics.minimumDpi = Math.min(statistics.minimumDpi ?? dpi, dpi)
      }
      const ref = vectorRef || image!.ref
      resources.set(ref, `/X${ref} ${ref} 0 R`)
      const [width,height] = image ? [image.width, image.height] : [glyph.asset.width,glyph.asset.height]
      content.push('q', `/G${states.get(state)} gs`, row(cos, sin, -sin, cos, transform.x, transform.y) + ' cm',
        row(1, transform.skewY, transform.skewX, 1, 0, 0) + ' cm',
        row(transform.scaleX, 0, 0, transform.scaleY, 0, 0) + ' cm',
        vectorRef ? row(1, 0, 0, 1, -width / 2, -height / 2) + ' cm'
          : row(width, 0, 0, -height, -width / 2, height / 2) + ' cm',
        `/X${ref} Do Q`)
      if (vectorRef) statistics.vector++
      else statistics.raster++
      const char = characterIndices.get(glyph.character)!
      const textSize = Math.max(1, Math.min(width * Math.abs(transform.scaleX), height * Math.abs(transform.scaleY)) * media.scale)
      textLayer.push(`BT /F${Math.floor(char / 240)} ${number(textSize)} Tf 3 Tr
        1 0 0 1 ${row(media.x + transform.x * media.scale - textSize / 2,
          media.height - media.y - transform.y * media.scale - textSize / 3)} Tm
        <${((char % 240) + 1).toString(16).padStart(2, '0')}> Tj ET`)
    }
    content.push('Q', ...textLayer)
    const stream = pdf.stream('', content.join('\n'))
    const fontObjects = fonts.map((ref, i) => `/F${i} ${ref} 0 R`).join(' ')
    pageIds.push(pdf.add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${row(media.width, media.height)}]
      /Resources << /Font << ${fontObjects} >> /XObject << ${[...resources.values()].join(' ')} >>
      /ExtGState << ${[...states.values()].map((id) => `/G${id} ${id} 0 R`).join(' ')} >> >>
      /Contents ${stream} 0 R >>`))
    options.progress?.(index + 1, pages.length)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  options.signal?.throwIfAborted()
  files.push({ name: 'calligra-layout.json', data: encode.encode(JSON.stringify({
    paper: options.paper, preset: options.preset, original_text: options.originalText, restoration: options.restoration,
    ...statistics, glyph_counts: pages.map((page) => page.glyphs.length),
  })) })
  const attachments = files.sort((a,b) => a.name.localeCompare(b.name, 'en')).map(({ name, data }) => {
    if (!/^[\w./-]+$/.test(name)) throw new Error('Invalid PDF attachment name')
    const payload = pdf.stream('/Type /EmbeddedFile', new Uint8Array(data))
    return `(${name}) ${pdf.add(`<< /Type /Filespec /F (${name}) /EF << /F ${payload} 0 R >> >>`)} 0 R`
  })
  pdf.set(pageTree, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`)
  const catalogRef = pdf.add(`<< /Type /Catalog /Pages ${pageTree} 0 R /Names << /EmbeddedFiles << /Names [${attachments.join(' ')}] >> >> >>`)
  const info = pdf.add('<< /Creator (Calligra) /Producer (Calligra Hybrid PDF) >>')
  return { blob: pdf.finish(catalogRef, info), statistics }
}
