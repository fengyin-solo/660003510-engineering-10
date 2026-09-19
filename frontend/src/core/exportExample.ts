/**
 * 示例导出：导出内容一律附带 provenance（来源数据文件、来源类型、导出于哪个文件），
 * 拿到导出文件即可追溯其对应的数据文件。
 */
import type { SQLTemplate, DataProvenance } from './types'

export interface ExportEnvelope<T> {
  kind: 'sql-template' | 'example-library'
  exportedAt: string
  provenance: {
    /** 统一读取规则下的逻辑路径，如 data/templates.json */
    sourceFile: string
    /** external=外部可编辑数据文件；builtin=随包内置兜底副本 */
    origin: 'external' | 'builtin'
  }
  data: T
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 导出单个 SQL 模板，文件名与内容都可追溯到来源数据文件 */
export function exportTemplate(template: SQLTemplate, index: number, source: DataProvenance) {
  const envelope: ExportEnvelope<SQLTemplate> = {
    kind: 'sql-template',
    exportedAt: new Date().toISOString(),
    provenance: { sourceFile: source.sourceFile, origin: source.origin },
    data: { ...template },
  }
  const safeName = template.name.replace(/[\\/:*?"<>|\s]+/g, '_')
  download(`sql-template-${String(index + 1).padStart(2, '0')}-${safeName}.json`, JSON.stringify(envelope, null, 2))
}

/** 导出当前整个示例库（表结构 + 模板），保留两份数据各自的来源 */
export function exportLibrary(payload: {
  schema: unknown
  templates: unknown
  schemaSource: DataProvenance
  templatesSource: DataProvenance
}) {
  const envelope = {
    kind: 'example-library',
    exportedAt: new Date().toISOString(),
    provenance: [
      { sourceFile: payload.schemaSource.sourceFile, origin: payload.schemaSource.origin },
      { sourceFile: payload.templatesSource.sourceFile, origin: payload.templatesSource.origin },
    ],
    data: {
      schema: payload.schema,
      templates: payload.templates,
    },
  }
  download('sql-example-library.json', JSON.stringify(envelope, null, 2))
}
