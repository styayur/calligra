import { uiText } from "../i18n"
export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type InkPolarity = 'auto' | 'dark' | 'light'
export type ExtractionMode = 'original' | 'clean' | 'restored'

export interface InkOptions {
  polarity: InkPolarity
  threshold: number
  padding: number
  mode: ExtractionMode
}

const lightness = (data: Uint8ClampedArray, index: number) =>
  (data[index] * 54 + data[index + 1] * 183 + data[index + 2] * 19) / 256

function background(image: Pixels) {
  const { data, width, height } = image
  const samples: number[] = []
  const step = Math.max(1, Math.floor(Math.max(width, height) / 512))
  for (let x = 0; x < width; x += step) {
    for (const y of [0, height - 1]) {
      const index = (y * width + x) * 4
      if (data[index + 3] > 24) samples.push(lightness(data, index))
    }
  }
  for (let y = 1; y < height - 1; y += step) {
    for (const x of [0, width - 1]) {
      const index = (y * width + x) * 4
      if (data[index + 3] > 24) samples.push(lightness(data, index))
    }
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] ?? 255
}

export function inkMask(image: Pixels, { polarity, threshold, mode }: InkOptions, paper = background(image)): Uint8Array {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
    throw new Error(uiText("阈值必须在 0 至 100 之间"))
  const lightInk = polarity === 'light' || (polarity === 'auto' && paper < 128)
  const contrast = Math.max(24, lightInk ? 255 - paper : paper)
  const floor = threshold / 100
  const mask = new Uint8Array(image.width * image.height)
  for (let i = 0; i < mask.length; i++) {
    const pixel = i * 4
    const separation = (lightness(image.data, pixel) - paper) * (lightInk ? 1 : -1) / contrast
    const strength = Math.min(1, Math.max(0, (separation - floor) / Math.max(.01, 1 - floor)))
    mask[i] = Math.round(strength * image.data[pixel + 3])
  }
  if (mode !== 'restored') return mask

  // Close one-pixel gaps along a stroke without touching unrelated pixels.
  const repaired = mask.slice()
  const { width, height } = image
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const horizontal = Math.min(mask[i - 1], mask[i + 1])
      const vertical = Math.min(mask[i - width], mask[i + width])
      const fill = Math.max(horizontal, vertical)
      if (fill >= 128) repaired[i] = Math.max(repaired[i], fill)
    }
  }
  return repaired
}

function inkBounds(mask: Uint8Array, stride: number, within: Crop): Crop | undefined {
  let left = within.x + within.width
  let top = within.y + within.height
  let right = within.x - 1
  let bottom = within.y - 1
  for (let y = within.y; y < within.y + within.height; y++) {
    for (let x = within.x; x < within.x + within.width; x++) {
      if (mask[y * stride + x] < 24) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left) return undefined
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

function bands(counts: Uint32Array, minCount: number, gap: number): [number, number][] {
  const result: [number, number][] = []
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < minCount) continue
    const last = result.at(-1)
    if (last && i - last[1] <= gap) last[1] = i
    else result.push([i, i])
  }
  return result
}

/** Projection-based suggestions. Connected or irregular glyphs require editorial review. */
export function locateCrops(image: Pixels, options: InkOptions, vertical: boolean): Crop[] {
  const { width, height } = image
  const mask = inkMask(image, { ...options, mode: 'clean' })
  const majorSize = vertical ? width : height
  const minorSize = vertical ? height : width
  const major = new Uint32Array(majorSize)
  const index = (a: number, b: number) => vertical ? b * width + a : a * width + b
  for (let a = 0; a < majorSize; a++)
    for (let b = 0; b < minorSize; b++)
      if (mask[index(a, b)] >= 64) major[a]++
  const lines = bands(major, Math.max(2, Math.floor(minorSize / 500)), Math.max(2, Math.floor(majorSize / 120)))
  if (vertical) lines.reverse()
  const crops: Crop[] = []
  for (const [start, end] of lines) {
    const minor = new Uint32Array(minorSize)
    for (let a = start; a <= end; a++)
      for (let b = 0; b < minorSize; b++)
        if (mask[index(a, b)] >= 64) minor[b]++
    for (const [first, last] of bands(minor, 1, Math.max(2, Math.floor((end - start) / 5)))) {
      const box = vertical
        ? { x: start, y: first, width: end - start + 1, height: last - first + 1 }
        : { x: first, y: start, width: last - first + 1, height: end - start + 1 }
      const tight = inkBounds(mask, width, box)
      if (tight && tight.width * tight.height >= 9) crops.push(tight)
      if (crops.length === 200) return crops
    }
  }
  return crops
}

/** Divide an editor-selected regular text region without copying or modifying scan pixels. */
export function gridCrops(region: Crop, rows: number, columns: number, vertical: boolean): Crop[] {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 ||
      rows * columns > 200 || columns > region.width || rows > region.height) {
    throw new RangeError(uiText('行列数无效，最多生成 200 个切框。'))
  }
  const boxes: Crop[] = []
  for (let index = 0; index < rows * columns; index++) {
    const row = vertical ? index % rows : Math.floor(index / columns)
    const column = vertical ? columns - 1 - Math.floor(index / rows) : index % columns
    const left = Math.round(column * region.width / columns)
    const top = Math.round(row * region.height / rows)
    boxes.push({
      x: region.x + left, y: region.y + top,
      width: Math.round((column + 1) * region.width / columns) - left,
      height: Math.round((row + 1) * region.height / rows) - top,
    })
  }
  return boxes
}

export function imageDimensions(bytes: Uint8Array): [number, number] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const match = (offset: number, value: string) => [...value].every((c, i) => bytes[offset + i] === c.charCodeAt(0))
  if (bytes.length >= 24 && bytes[0] === 137 && match(1, 'PNG\r\n\x1a\n') && match(12, 'IHDR'))
    return [view.getUint32(16), view.getUint32(20)]
  if (bytes.length >= 30 && match(0, 'RIFF') && match(8, 'WEBP')) {
    const le24 = (offset: number) => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16
    if (match(12, 'VP8X') && (bytes[20] & 2) === 0) return [1 + le24(24), 1 + le24(27)]
    if (match(12, 'VP8L') && bytes[20] === 47)
      return [1 + (view.getUint16(21, true) & 0x3fff), 1 + ((view.getUint32(21, true) >>> 14) & 0x3fff)]
    if (match(12, 'VP8 ') && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42)
      return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff]
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let i = 2
    while (i + 8 < bytes.length && bytes[i++] === 255) {
      while (bytes[i] === 255) i++
      const marker = bytes[i++]
      if (marker === 218 || marker === 217 || i + 7 >= bytes.length) break
      const length = view.getUint16(i)
      if (length < 2 || i + length > bytes.length) break
      if ([192, 193, 194].includes(marker) && length >= 8)
        return [view.getUint16(i + 5), view.getUint16(i + 3)]
      i += length
    }
  }
}

export async function openScan(file: File) {
  if (!file.size || file.size > 16 * 1024 * 1024) throw new Error(uiText("图像文件上限为 16 MiB"))
  const bytes = new Uint8Array(await file.arrayBuffer())
  const dimensions = imageDimensions(bytes)
  if (!dimensions) throw new Error(uiText("请选择有效的 PNG、JPEG 或静态 WebP"))
  const valid = (width: number, height: number) =>
    width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_000_000
  if (!valid(...dimensions)) throw new Error(uiText("图像上限为 1600 万像素，单边不超过 8192 像素"))
  const bitmap = await createImageBitmap(file)
  try {
    if (!valid(bitmap.width, bitmap.height)) throw new Error(uiText("图像尺寸超出上限"))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0)
    return { canvas, context, bytes }
  } finally {
    bitmap.close()
  }
}

export function cropGlyph(source: CanvasRenderingContext2D, box: Crop, options: InkOptions) {
  if (!Object.values(box).every(Number.isSafeInteger) || box.x < 0 || box.y < 0 ||
      box.width < 1 || box.height < 1 || box.x + box.width > source.canvas.width ||
      box.y + box.height > source.canvas.height || box.width * box.height > 4_000_000)
    throw new Error(uiText("切框必须位于原图内，且单字不超过 400 万像素"))
  if (!Number.isInteger(options.padding) || options.padding < 0 || options.padding > 256)
    throw new Error(uiText("留白必须在 0 至 256 像素之间"))
  const input = source.getImageData(box.x, box.y, box.width, box.height)
  const output = document.createElement('canvas')
  if (options.mode === 'original') {
    output.width = box.width
    output.height = box.height
    output.getContext('2d')!.putImageData(input, 0, 0)
    return output
  }
  const left = Math.max(0, box.x - 3)
  const top = Math.max(0, box.y - 3)
  const right = Math.min(source.canvas.width, box.x + box.width + 3)
  const bottom = Math.min(source.canvas.height, box.y + box.height + 3)
  const paper = background(source.getImageData(left, top, right - left, bottom - top))
  const mask = inkMask(input, options, paper)
  const bounds = inkBounds(mask, input.width, { x: 0, y: 0, width: input.width, height: input.height })
  if (!bounds) throw new Error(uiText("切框内没有可用墨迹，请调整阈值或墨迹极性"))
  const padding = options.padding
  output.width = bounds.width + padding * 2
  output.height = bounds.height + padding * 2
  const context = output.getContext('2d')!
  const pixels = context.createImageData(bounds.width, bounds.height)
  for (let y = 0; y < bounds.height; y++)
    for (let x = 0; x < bounds.width; x++)
      pixels.data[(y * bounds.width + x) * 4 + 3] = mask[(y + bounds.y) * input.width + x + bounds.x]
  context.putImageData(pixels, padding, padding)
  return output
}
