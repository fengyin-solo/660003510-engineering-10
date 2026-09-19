import type {
  SQLTable,
  TemplateFile,
  SchemaFile,
  ValidationIssue,
} from './types'

export interface DataFileDescriptor {
  file: string
  kind: 'schema' | 'templates'
  label: string
}

export const DATA_FILES: readonly DataFileDescriptor[]

export function extractReferencedTables(sql: string): string[]

export function validateSchema(data: unknown, file?: string): ValidationIssue[]

/** 模板自身结构校验（字段缺失、模板重名等），不检查表引用 */
export function validateTemplatesStructure(data: unknown, file?: string): ValidationIssue[]

/** 跨文件校验：模板 SQL 引用的表必须在 schema 中存在 */
export function validateTemplateTableRefs(
  data: { templates?: Array<{ name?: unknown; sql?: unknown }> },
  schemaTableNames: string[],
  file?: string,
): ValidationIssue[]

/** 模板完整校验：结构 + 表引用 */
export function validateTemplates(
  data: unknown,
  schemaTableNames: string[],
  file?: string,
): ValidationIssue[]

export function parseDataFile(
  file: string,
  rawText: string,
):
  | { ok: true; data: unknown }
  | { ok: false; data: null; issues: ValidationIssue[] }

export function hasErrors(issues: ValidationIssue[]): boolean

export function formatIssues(issues: ValidationIssue[]): string[]

// 仅用于让类型文件持有数据文件的结构类型，避免被误删
export type { SQLTable, TemplateFile, SchemaFile }
