import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loadDataset, DataLoadError } from '@/data/loader'
import { getSourceOf } from '@/data/validator.js'
import type { SQLTable, SQLTemplate, ValidationIssue } from '@/data/validator'

export type { SQLTable, SQLTemplate, ValidationIssue }

export interface QueryPlan {
  operation: string
  table?: string
  cost: number
  rows: number
  children: QueryPlan[]
  index?: string
  filter?: string
}

export interface ParsedQuery {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'UNKNOWN'
  tables: string[]
  columns: string[]
  joins: { type: string; table: string; condition: string }[]
  whereConditions: string[]
  orderBy: string[]
  groupBy: string[]
  limit?: number
  complexity: number
  suggestions: string[]
  estimatedCost: number
}

export type DataStatus = 'loading' | 'ready' | 'error'

/** 从 SQL 文本中提取 FROM/JOIN/INTO/UPDATE 后引用的表名 */
function referencedTables(sql: string): string[] {
  return Array.from(
    sql.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_]\w*)/gi),
    m => m[1].toLowerCase()
  )
}

function parseSQL(sql: string, schemaTables: SQLTable[]): ParsedQuery {
  const up = sql.toUpperCase().trim()
  const type = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'].find(t => up.startsWith(t)) as ParsedQuery['type'] || 'UNKNOWN'
  const tables = referencedTables(sql)
  const columns = type === 'SELECT' ? Array.from(sql.matchAll(/SELECT\s+([\s\S]*?)\s+FROM/gi))[0]?.[1]?.split(',').map((s: string) => s.trim()) || [] : []
  const joins = Array.from(sql.matchAll(/(LEFT|RIGHT|INNER|OUTER|CROSS|FULL)?\s*JOIN\s+([a-zA-Z_]\w*)\s+ON\s+([^JOIN|WHERE|GROUP|ORDER|LIMIT]+)/gi)).map(m => ({ type: (m[1] || 'INNER').trim(), table: m[2], condition: m[3].trim() }))
  const whereMatch = sql.match(/WHERE\s+([\s\S]*?)(?:GROUP|ORDER|LIMIT|$)/i)
  const whereConditions = whereMatch ? whereMatch[1].split(/\s+AND\s+|\s+OR\s+/i).map(s => s.trim()).filter(Boolean) : []
  const orderBy = Array.from(sql.matchAll(/ORDER\s+BY\s+([\s\S]*?)(?:LIMIT|$)/gi))[0]?.[1]?.split(',').map((s: string) => s.trim()) || []
  const groupBy = Array.from(sql.matchAll(/GROUP\s+BY\s+([\s\S]*?)(?:HAVING|ORDER|LIMIT|$)/gi))[0]?.[1]?.split(',').map((s: string) => s.trim()) || []
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  const limit = limitMatch ? parseInt(limitMatch[1]) : undefined

  const complexity = tables.length + joins.length * 2 + whereConditions.length + orderBy.length + (sql.includes('DISTINCT') ? 3 : 0) + (sql.includes('HAVING') ? 2 : 0)
  const estimatedCost = tables.reduce((sum, t) => { const tbl = schemaTables.find(s => s.name === t); return sum + (tbl?.rowCount ?? 1000) }, 0) * (joins.length + 1) / (limit || 100)

  const suggestions: string[] = []
  if (joins.length > 3) suggestions.push('连接表过多（>3），考虑分解查询')
  if (!whereConditions.length && type === 'SELECT') suggestions.push('无 WHERE 条件，将扫描全表')
  if (sql.includes('SELECT *')) suggestions.push('避免 SELECT *，明确指定列名')
  if (sql.toUpperCase().includes("LIKE '%")) suggestions.push("前缀通配符 LIKE '%...' 无法使用索引")
  if (!limit && type === 'SELECT') suggestions.push('建议添加 LIMIT 限制结果集大小')

  return { type, tables, columns, joins, whereConditions, orderBy, groupBy, limit, complexity, suggestions, estimatedCost: Math.round(estimatedCost) }
}

function buildPlan(parsed: ParsedQuery, schemaTables: SQLTable[]): QueryPlan {
  if (parsed.tables.length === 0) return { operation: 'EMPTY', cost: 0, rows: 0, children: [] }
  const tableScans: QueryPlan[] = parsed.tables.map(t => {
    const tbl = schemaTables.find(s => s.name === t)
    const rowCount = tbl?.rowCount ?? 1000
    return { operation: parsed.whereConditions.length > 0 ? 'Index Scan' : 'Seq Scan', table: t, cost: rowCount * 0.01, rows: Math.round(rowCount * (parsed.whereConditions.length > 0 ? 0.1 : 1)), children: [], index: parsed.whereConditions.length > 0 ? 'idx_' + t + '_id' : undefined }
  })
  if (tableScans.length === 1) {
    return { operation: 'Sort', cost: tableScans[0].cost * 1.2, rows: tableScans[0].rows, children: [tableScans[0]] }
  }
  const join: QueryPlan = { operation: 'Hash Join', cost: tableScans.reduce((s, n) => s + n.cost, 0) * 1.5, rows: Math.round(tableScans[0].rows * 0.5), children: tableScans, filter: parsed.joins[0]?.condition }
  return { operation: parsed.orderBy.length ? 'Sort' : 'Result', cost: join.cost * 1.1, rows: join.rows, children: [join] }
}

export const useSQLStore = defineStore('sql', () => {
  // 数据加载状态
  const status = ref<DataStatus>('loading')
  const loadError = ref('')
  const dataIssues = ref<ValidationIssue[]>([])
  const schemaFile = ref('')
  const templatesFile = ref('')

  // 示例数据（只由 loadDataset 填充，业务代码不再硬编码）
  const schemaTables = ref<SQLTable[]>([])
  const templates = ref<SQLTemplate[]>([])

  // 当前编辑/分析状态
  const activeTemplateId = ref<string | null>(null)
  const sql = ref('')
  const parsed = ref<ParsedQuery | null>(null)
  const plan = ref<QueryPlan | null>(null)
  const activeSchema = ref<SQLTable | null>(null)

  const activeTemplate = computed(
    () => templates.value.find(t => t.id === activeTemplateId.value) ?? null
  )
  /** 编辑器内容与所选模板不一致（用户改过或手动分析后），用于提示“恢复模板原文” */
  const sqlDirty = computed(() => activeTemplate.value !== null && sql.value !== activeTemplate.value.sql)

  function runAnalysis() {
    if (status.value !== 'ready') { parsed.value = null; plan.value = null; return }
    parsed.value = parseSQL(sql.value, schemaTables.value)
    plan.value = buildPlan(parsed.value, schemaTables.value)
  }

  function analyze() {
    runAnalysis()
  }

  /** 切换模板：载入模板 SQL 并立即重新分析，保证展示结果与所选模板一致 */
  function selectTemplate(id: string) {
    const tpl = templates.value.find(t => t.id === id)
    if (!tpl) return
    activeTemplateId.value = id
    sql.value = tpl.sql
    runAnalysis()
  }

  /** 放弃编辑区改动，恢复当前模板原文并重新分析 */
  function resetToTemplate() {
    if (activeTemplate.value) {
      sql.value = activeTemplate.value.sql
      runAnalysis()
    }
  }

  async function init() {
    status.value = 'loading'
    loadError.value = ''
    dataIssues.value = []
    try {
      const dataset = await loadDataset()
      schemaFile.value = dataset.schemaFile
      templatesFile.value = dataset.templatesFile
      schemaTables.value = dataset.tables
      templates.value = dataset.templates
      const first = dataset.templates[0]
      activeTemplateId.value = first.id
      sql.value = first.sql
      status.value = 'ready'
      runAnalysis()
    } catch (err) {
      status.value = 'error'
      parsed.value = null
      plan.value = null
      if (err instanceof DataLoadError) {
        loadError.value = err.message
        dataIssues.value = err.issues
      } else {
        loadError.value = err instanceof Error ? err.message : String(err)
      }
    }
  }

  const complexityLabel = computed(() => {
    const c = parsed.value?.complexity || 0
    if (c <= 2) return { label: '简单', color: 'text-green-400' }
    if (c <= 5) return { label: '中等', color: 'text-yellow-400' }
    if (c <= 8) return { label: '复杂', color: 'text-orange-400' }
    return { label: '非常复杂', color: 'text-red-400' }
  })

  /**
   * 导出当前示例 SQL。内容带头注释，可追溯到来源数据文件与模板 id；
   * 基于编辑区内容导出（若已修改同样可追溯其来源）。
   */
  function exportActiveTemplate(): boolean {
    const tpl = activeTemplate.value
    if (!tpl || !sql.value.trim()) return false
    const source = getSourceOf(tpl) || templatesFile.value
    const stamp = new Date().toISOString()
    const header =
      `-- 示例模板: ${tpl.name} (id: ${tpl.id})\n` +
      `-- 来源数据文件: ${source}\n` +
      (sqlDirty.value ? '-- 注意: 内容相对数据文件中的模板已被修改\n' : '') +
      `-- 导出时间: ${stamp}\n\n`
    const blob = new Blob([header + sql.value + '\n'], { type: 'text/sql;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tpl.id}.sql`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return true
  }

  return {
    status, loadError, dataIssues, schemaFile, templatesFile,
    schemaTables, templates,
    activeTemplateId, activeTemplate, sqlDirty, sql,
    parsed, plan, activeSchema,
    complexityLabel,
    init, analyze, selectTemplate, resetToTemplate, exportActiveTemplate
  }
})
