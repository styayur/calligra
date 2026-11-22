import type { GlyphInstance } from './glyph'
import type { BatchLayout } from './composition'
import type { CandidatePolicy } from '../lib/candidatePolicy'

export interface CompositionSettings {
  layout: BatchLayout
  columns: number
  size: number
  gap: number
  margin: number
  punctuation: boolean
  style: string
  source: 'fonts' | 'original' | 'all' | 'fallback' | 'private'
  /** Optional cultural and font preferences. Schema 2 projects without a font ID use Auto. */
  policy?: CandidatePolicy
}

export interface CanvasConfig {
  width: number
  height: number
  background: string
}

export interface ProjectDocument {
  version: 1 | 2
  canvas: CanvasConfig
  glyphs: GlyphInstance[]
  text?: string
  composition?: CompositionSettings
}

export interface ProjectRecord {
  id: string
  name: string
  document: ProjectDocument
}

export interface ProjectListItem {
  id: string
  name: string
}
