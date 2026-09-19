export interface SQLColumn {
  name: string
  type: string
  pk?: boolean
  fk?: string
}

export interface SQLTable {
  name: string
  columns: SQLColumn[]
  rowCount: number
  [SOURCE]?: string
}

export interface SQLTemplate {
  id: string
  name: string
  sql: string
  [SOURCE]?: string
}

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  severity: IssueSeverity
  file: string
  code: string
  message: string
}

export interface DataFileEntry {
  id?: string
  kind?: string
  file?: string
  required?: boolean
  text?: string | null
  readError?: string | null
}

export interface Dataset {
  schemaFile: string
  templatesFile: string
  tables: SQLTable[]
  templates: SQLTemplate[]
}

export interface AssembleResult {
  issues: ValidationIssue[]
  dataset: Dataset | null
}

export const SOURCE: unique symbol

export function isNonEmptyString(v: unknown): v is string
export function extractTableNames(sql: string): string[]
export function validateManifest(raw: unknown, file?: string): ValidationIssue[]
export function validateSchema(raw: unknown, file?: string): ValidationIssue[]
export function validateTemplates(raw: unknown, tableNames: Set<string> | string[], file?: string): ValidationIssue[]
export function parseDataFile(text: string, file: string):
  { ok: true; data: unknown } | { ok: false; issues: ValidationIssue[] }
export function assembleDataset(params: { manifest: unknown; entries: DataFileEntry[] }): AssembleResult
export function getSourceOf(obj: unknown): string | null
export function formatIssues(issues: ValidationIssue[]): string
