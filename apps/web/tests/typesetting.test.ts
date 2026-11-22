import assert from 'node:assert/strict'
import { analyzeText, segmentText, verticalOrientation } from '../src/lib/textLayout'
import { variationPairs } from '../src/lib/identity'
import type { TypesettingOptions } from '../src/types/typesetting'

const base: TypesettingOptions = {
  layout: 'horizontal-ltr', tradition: 'Japanese', language: 'und',
  mixed: false, kinsoku: true, compressPunctuation: false, automaticTcy: false, tcy: [],
}
const lines = (text: string, width: number, options: Partial<TypesettingOptions> = {}) =>
  analyzeText(text, { ...base, ...options }, width).lines.map((line) => line.units.map((unit) => unit.text).join(''))

// Representative independent expectations from UAX14 LB14/LB13/LB18/LB28, JLReq and KLReq.
assert.deepEqual(lines('甲（乙）丙', 3), ['甲', '（乙）', '丙'])
assert.deepEqual(lines('かきゃ', 2), ['か', 'きゃ'])
assert.deepEqual(lines('한글 문장', 2.35, { tradition: 'Korean' }), ['한글 ', '문장'])
assert.deepEqual(lines('East Asian', 2), ['East ', 'Asian'])
assert.deepEqual(lines('A \tB\r\n\nC', 40), ['A \tB\r\n', '\n', 'C'])
assert.deepEqual(lines('甲乙\n', 40), ['甲乙\n', ''])
assert.deepEqual(lines('甲（乙）丙', 2, { kinsoku: false }), ['甲（', '乙）', '丙'])

assert.deepEqual(['漢', '한', '「', '。', 'A'].map(verticalOrientation), ['U', 'U', 'Tr', 'Tu', 'R'])
const vertical = analyzeText('12月 2026年 AI No.1 XQZ', { ...base, layout: 'vertical-rtl', automaticTcy: true }, 30)
assert.deepEqual(vertical.units.filter(({ kind }) => kind === 'tcy').map(({ text }) => text), ['12', '2026', 'AI', 'No.1'])
assert.ok(vertical.units.filter(({ kind }) => kind === 'tcy').every(({ direction }) => direction === 'ltr'))
assert.equal(vertical.runs.find((run) => run.text === 'XQZ')?.direction, 'ltr')
const groups = analyzeText('𠮷abc', { ...base, layout: 'vertical-rtl', tcy: [{ start: 2, end: 5 }] }, 5)
assert.equal(groups.units[1].kind, 'tcy')
assert.throws(() => analyzeText('𠮷abc', { ...base, tcy: [{ start: 1, end: 5 }] }, 4), /grapheme/)
assert.throws(() => analyzeText('漢 א', base, 5), /bidi/)

const ivs = '垕\u{E0102}'
assert.deepEqual(variationPairs(ivs), [[0x5795, 0xe0102]])
assert.equal(variationPairs('A\u{E0102}'), undefined)
assert.equal(variationPairs('\u{E0102}'), undefined)
assert.equal(variationPairs(ivs + '\u{E0103}'), undefined)
assert.deepEqual(segmentText(ivs + '남').map(({ text, start, end }) => [text, start, end]),
  [[ivs, 0, 3], ['남', 3, 6]])
const mixed = analyzeText('中文 日本かな 한漢 A', { ...base, tradition: 'Chinese', mixed: true }, 20)
assert.equal(mixed.runs.find((run) => run.text === '中文')?.tradition, 'Chinese')
assert.equal(mixed.runs.find((run) => run.text === '日本')?.tradition, 'Japanese')
assert.equal(mixed.runs.find((run) => run.text === '漢')?.tradition, 'Korean')
assert.equal(mixed.runs.find((run) => run.text === 'A')?.language, 'en')
console.log('PASS: Unicode 18 orientation, CJK/Latin wrapping, raw whitespace, mixed traditions, TCY and IVS offsets')
