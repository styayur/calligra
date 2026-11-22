import type { PdfOptions } from '../../lib/hybridPdf'
import { uiText } from '../../i18n'

export type PdfPaper = Pick<PdfOptions, 'paper' | 'preset' | 'widthMm' | 'heightMm'>
export const PDF_PAPER: PdfPaper = { paper: 'artwork', preset: 'reading', widthMm: 210, heightMm: 297 }

export function PdfSettings({ value, onChange }: { value: PdfPaper; onChange: (next: PdfPaper) => void }) {
  return <details className="advanced">
    <summary>{uiText('PDF 纸张与输出')}</summary>
    <label>{uiText('纸张尺寸')}
      <select aria-label={uiText('纸张尺寸')} value={value.paper}
        onChange={(event) => onChange({ ...value, paper: event.target.value as PdfPaper['paper'] })}>
        <option value="artwork">{uiText('作品尺寸')}</option>
        <option value="a4">A4</option>
        <option value="a3">A3</option>
        <option value="custom">{uiText('自定义尺寸')}</option>
      </select>
    </label>
    {value.paper === 'custom' && <div className="field-grid">
      <label>{uiText('纸张宽度 (mm)')}<input type="number" min="20" max="2000" value={value.widthMm}
        onChange={(event) => onChange({ ...value, widthMm: Number(event.target.value) })} /></label>
      <label>{uiText('纸张高度 (mm)')}<input type="number" min="20" max="2000" value={value.heightMm}
        onChange={(event) => onChange({ ...value, heightMm: Number(event.target.value) })} /></label>
    </div>}
    <label>{uiText('PDF 用途')}
      <select aria-label={uiText('PDF 用途')} value={value.preset}
        onChange={(event) => {
          const preset = event.target.value as PdfPaper['preset']
          onChange({ ...value, preset, paper: preset === 'print' && value.paper === 'artwork' ? 'a4' : value.paper })
        }}>
        <option value="reading">{uiText('数字阅读')}</option>
        <option value="print">{uiText('印刷优先')}</option>
        <option value="archive">{uiText('档案保真')}</option>
      </select>
    </label>
  </details>
}
