import { useEffect, useState } from 'react'
import { uiText } from '../../i18n'
import { restorationCandidates, restorationDecision, type RestorationCandidate, type RestorationKind } from '../../lib/glyphRestoration'
import { textCharacters } from '../../lib/identity'
import { useEditorStore } from '../../stores/editor'

const labels: Record<RestorationKind, string> = {
  'same-work': '同作品或异本', 'same-author': '同书家同书体', 'exact-original': '可复核的同字原帖',
  coverage: '同地区字体补字', components: 'IDS 部件合成', variant: '有据异体', loan: '文献通假', editorial: '人工校勘',
}

export function RestorationPanel() {
  const project = useEditorStore((state) => state.project)
  const apply = useEditorStore((state) => state.applyRestoration)
  const records = project.restorations || []
  const [range, setRange] = useState<number>()
  const slot = records.find((item) => item.start === range)
  const [results, setResults] = useState<RestorationCandidate[]>([])
  const [manual, setManual] = useState('')
  const [confirmation, setConfirmation] = useState<RestorationCandidate>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setConfirmation(undefined); setResults([]); setManual('') }, [project.text, range])
  if (!records.length) return null

  const search = async (override?: string) => {
    if (!slot || project.text === undefined || busy) return
    setBusy(true)
    setConfirmation(undefined)
    setMessage('')
    try {
      const anchor = project.glyphs.find((glyph) => glyph.provenance.type === 'original')?.source
      const candidates = await restorationCandidates(project.text, slot,
        { ...project.composition?.policy, vertical: project.composition?.layout === 'vertical-rtl' }, anchor, override)
      setResults(candidates)
      if (!candidates.length) setMessage(uiText('暂无有据且可用的字形'))
    } catch (error) {
      setMessage(String(error))
    } finally {
      setBusy(false)
    }
  }
  const useCandidate = (candidate: RestorationCandidate) => {
    if (!slot) return
    apply(slot, restorationDecision(candidate, true), candidate.glyph)
    setConfirmation(undefined)
    setMessage(uiText('补字决定已保存'))
  }

  return <details className="advanced restoration-panel" open={records.some((record) => !record.decisions.length) || undefined}>
    <summary>{uiText('补字与校勘')} ({records.length})</summary>
    <label>{uiText('待处理位置')}
      <select aria-label={uiText('待处理位置')} value={range ?? ''} disabled={busy}
        onChange={(event) => setRange(event.target.value ? Number(event.target.value) : undefined)}>
        <option value="">{uiText('请选择')}</option>
        {records.map((record) => <option key={record.start} value={record.start}>
          {record.start + 1} · {record.text} · {record.decisions.length ? uiText('已记录') : uiText('待复核')}
        </option>)}
      </select>
    </label>
    {slot && <>
      <button type="button" disabled={busy} onClick={() => void search()}>{uiText('查找补字候选')}</button>
      <label>{uiText('人工补入文字')}
        <input value={manual} onChange={(event) => setManual(event.target.value)} maxLength={32} />
      </label>
      <button type="button" disabled={busy || textCharacters(manual.trim()).length !== 1}
        onClick={() => void search(manual.trim())}>{uiText('查找拟补字形')}</button>
      <ul className="private-glyphs">
        {results.map((candidate) => <li key={candidate.kind + candidate.glyph.id}>
          <img width="44" height="44" src={candidate.glyph.asset.url} alt={candidate.glyph.character} />
          <span>{uiText(labels[candidate.kind])} · {candidate.glyph.source.work || candidate.glyph.source.dataset}
            {' · '}{candidate.glyph.source.license || uiText('授权未标注')}</span>
          {candidate.source?.startsWith('https://') && <a href={candidate.source}
            target="_blank" rel="noreferrer">{uiText('出处')}</a>}
          <button type="button" onClick={() => candidate.glyph.character !== slot.text ?
            setConfirmation(candidate) : useCandidate(candidate)}>{uiText('采用字形')}</button>
        </li>)}
      </ul>
      {confirmation && <div role="group" aria-label={uiText('确认文字变更')}>
        <strong>{slot.text} → {confirmation.glyph.character}</strong>
        <button type="button" onClick={() => useCandidate(confirmation)}>{uiText('确认文字变更')}</button>
        <button type="button" onClick={() => setConfirmation(undefined)}>{uiText('取消')}</button>
      </div>}
      {slot.decisions.length > 0 && <ol>{slot.decisions.map((decision, index) =>
        <li key={index}>{uiText(labels[decision.kind])} · {decision.character} · {decision.glyphId}</li>)}</ol>}
    </>}
    {message && <p role="status">{message}</p>}
  </details>
}
