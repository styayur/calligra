import { uiText } from "../i18n"
import type { Glyph } from '../types'
import { sha256 } from '../lib/fontShaper'

const masks = new Map<string, Promise<Glyph>>()
/** Produce transparent ink masks only for the cleared historical sample. */
export async function prepareInk(glyph: Glyph): Promise<Glyph> {
  if (
    glyph.source.dataset !== 'CODH Kuzushiji' ||
    glyph.asset.type !== 'raster' ||
    glyph.asset.processing === 'ink-mask'
  )
    return glyph
  const key = glyph.asset.url
  if (glyph.source.rights?.derivatives_allowed === false) throw new Error('Glyph rights prohibit ink-mask adaptation')
  if (!masks.has(key))
    masks.set(
      key,
      new Promise<Glyph>((resolve, reject) => {
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.onerror = () => reject(new Error(uiText("「{{v0}}」原帖图片加载失败，请重试", { v0: glyph.character })))
        image.onload = async () => {
          try {
            if (Math.max(image.naturalWidth,image.naturalHeight) > 16000 || image.naturalWidth*image.naturalHeight > 32_000_000) throw new Error('Excessive image dimensions')
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            const context = canvas.getContext('2d')!
            context.drawImage(image, 0, 0)
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
            const { data } = pixels
            const luminance = (index: number) =>
              data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722
            const corners = [
              0,
              (canvas.width - 1) * 4,
              (canvas.height - 1) * canvas.width * 4,
              data.length - 4,
            ]
            const inverted = corners.reduce((sum, index) => sum + luminance(index), 0) / 4 < 128
            for (let i = 0; i < data.length; i += 4) {
              const ink = inverted ? luminance(i) : 255 - luminance(i)
              data[i + 3] = Math.round(data[i + 3] * Math.max(0, Math.min(1, (ink - 12) / 231)))
              data[i] = 23
              data[i + 1] = 27
              data[i + 2] = 26
            }
            context.putImageData(pixels, 0, 0)
            const url = canvas.toDataURL('image/png')
            const checksum = await sha256(await (await fetch(url)).arrayBuffer())
            resolve({
              ...glyph,
              asset: { ...glyph.asset, url, checksum, processing: 'ink-mask' },
              metadata: { ...glyph.metadata, original_asset_checksum:glyph.asset.checksum, processing:'transparent ink-mask from source crop', derivative_license:glyph.source.license },
            })
          } catch {
            reject(new Error(uiText("「{{v0}}」无法净底，请检查图片来源", { v0: glyph.character })))
          }
        }
        image.src = glyph.asset.url
      }).catch((error) => {
        masks.delete(key)
        throw error
      }),
    )
  return masks.get(key)!
}
