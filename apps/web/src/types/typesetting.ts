import type { BatchLayout } from './composition'
import type { TextLanguage } from './project'

export type VerticalOrientation = 'U' | 'R' | 'Tu' | 'Tr'
export type InlineDirection = 'ltr' | 'ttb'
export type Tradition = 'Chinese' | 'Japanese' | 'Korean'
export interface TextRange { start: number; end: number }
export interface TextSpan extends TextRange { language?: TextLanguage; tradition?: Tradition }
export interface TextCluster extends TextRange {
  text: string
  script: string | null
}
export interface GlyphPosition {
  id: number
  cluster: number
  x: number
  y: number
  advanceX: number
  advanceY: number
  width: number
  height: number
  rotation: number
}
export interface GlyphSequence extends TextRange {
  text: string
  fontId: string
  /** Absolute UTF-16 cluster offsets and metric positions in em units. */
  positions: GlyphPosition[]
  features: string[]
}
export interface TextRun extends TextRange {
  text: string
  script: string | null
  language: TextLanguage
  tradition: Tradition
  direction: InlineDirection
  orientation: VerticalOrientation
  tcy: boolean
  sequences: GlyphSequence[]
}
export interface LayoutUnit extends TextRange {
  text: string
  script: string | null
  kind: 'glyph' | 'space' | 'break' | 'tcy'
  direction: InlineDirection
  orientation: VerticalOrientation
  language: TextLanguage
  tradition: Tradition
  advanceEm: number
}
export interface TextLine {
  units: LayoutUnit[]
  advanceEm: number
  overflow: boolean
}
export interface TypesettingOptions {
  layout: BatchLayout
  tradition: Tradition
  language: TextLanguage
  mixed: boolean
  kinsoku: boolean
  compressPunctuation: boolean
  automaticTcy: boolean
  tcy: TextRange[]
  spans?: TextSpan[]
}
export type AdvancedTypography = Pick<TypesettingOptions,
  'mixed' | 'kinsoku' | 'compressPunctuation' | 'automaticTcy' | 'tcy' | 'spans'> & { discretionary: boolean }
export interface TextLayout {
  text: string
  clusters: TextCluster[]
  units: LayoutUnit[]
  lines: TextLine[]
  runs: TextRun[]
}
