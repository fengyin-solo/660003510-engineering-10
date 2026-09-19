/**
 * SQL 解析与执行计划构建的纯逻辑。
 * 不持有任何硬编码示例数据，schema 由调用方（store）从统一加载器传入。
 */
import type { ParsedQuery, QueryPlan, SQLTable } from './types'

export function parseSQL(sql: string, schema: SQLTable[]): ParsedQuery {
  const up = sql.toUpperCase().trim()
  const type = (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'].find(t => up.startsWith(t)) as ParsedQuery['type']) || 'UNKNOWN'
  const tables = Array.from(sql.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_]\w*)/gi)).map(m => m[1].toLowerCase())
  const columns = type === 'SELECT'
    ? (Array.from(sql.matchAll(/SELECT\s+([\s\S]*?)\s+FROM/gi))[0]?.[1]?.split(',').map((s: string) => s.trim()) || [])
    : []
  const joins = Array.from(sql.matchAll(/(LEFT|RIGHT|INNER|OUTER|CROSS|FULL)?\s*JOIN\s+([a-zA-Z_]\w*)\s+ON\s+([^JOIN|WHERE|GROUP|ORDER|LIMIT]+)/gi))
    .map(m => ({ type: (m[1] || 'INNER').trim(), table: m[2], condition: m[3].trim() }))
  const whereMatch = sql.match(/WHERE\s+([\s\S]*?)(?:GROUP|ORDER|LIMIT|$)/i)
  const whereConditions = whereMatch
    ? whereMatch[1].split(/\s+AND\s+|\s+OR\s+/i).map(s => s.trim()).filter(Boolean)
    : []
  const orderBy = Array.from(sql.matchAll(/ORDER\s+BY\s+([\s\S]*?)(?:LIMIT|$)/gi))[0]?.[1]?.split(',').map((s: string) => s.trim()) || []
  const groupBy = Array.from(sql.matchAll(/GROUP\s+BY\s+([\s\S]*?)(?:HAVING|ORDER|LIMIT|$)/gi))[0]?.[1]?.split(',').map((s: string) => s.trim()) || []
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  const limit = limitMatch ? parseInt(limitMatch[1]) : undefined

  const complexity = tables.length + joins.length * 2 + whereConditions.length + orderBy.length
    + (sql.includes('DISTINCT') ? 3 : 0) + (sql.includes('HAVING') ? 2 : 0)
  const estimatedCost = tables.reduce((sum, t) => {
    const tbl = schema.find(s => s.name === t)
    return sum + (tbl?.rowCount || 1000)
  }, 0) * (joins.length + 1) / (limit || 100)

  const suggestions: string[] = []
  if (joins.length > 3) suggestions.push('连接表过多（>3），考虑分解查询')
  if (!whereConditions.length && type === 'SELECT') suggestions.push('无 WHERE 条件，将扫描全表')
  if (sql.includes('SELECT *')) suggestions.push('避免 SELECT *，明确指定列名')
  if (sql.toUpperCase().includes("LIKE '%")) suggestions.push("前缀通配符 LIKE '%...' 无法使用索引")
  if (!limit && type === 'SELECT') suggestions.push('建议添加 LIMIT 限制结果集大小')

  return {
    type, tables, columns, joins, whereConditions, orderBy, groupBy,
    limit, complexity, suggestions, estimatedCost: Math.round(estimatedCost),
  }
}

export function buildPlan(parsed: ParsedQuery, schema: SQLTable[]): QueryPlan {
  if (parsed.tables.length === 0) return { operation: 'EMPTY', cost: 0, rows: 0, children: [] }
  const tableScans: QueryPlan[] = parsed.tables.map(t => {
    const tbl = schema.find(s => s.name === t)
    const rowCount = tbl?.rowCount || 1000
    return {
      operation: parsed.whereConditions.length > 0 ? 'Index Scan' : 'Seq Scan',
      table: t,
      cost: rowCount * 0.01,
      rows: Math.round(rowCount * (parsed.whereConditions.length > 0 ? 0.1 : 1)),
      children: [],
      index: parsed.whereConditions.length > 0 ? 'idx_' + t + '_id' : undefined,
    }
  })
  if (tableScans.length === 1) {
    return { operation: 'Sort', cost: tableScans[0].cost * 1.2, rows: tableScans[0].rows, children: [tableScans[0]] }
  }
  const join: QueryPlan = {
    operation: 'Hash Join',
    cost: tableScans.reduce((s, n) => s + n.cost, 0) * 1.5,
    rows: Math.round(tableScans[0].rows * 0.5),
    children: tableScans,
    filter: parsed.joins[0]?.condition,
  }
  return { operation: parsed.orderBy.length ? 'Sort' : 'Result', cost: join.cost * 1.1, rows: join.rows, children: [join] }
}
