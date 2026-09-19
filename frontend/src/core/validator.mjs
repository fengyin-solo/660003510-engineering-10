/**
 * 示例库统一校验器（无任何运行时依赖，可同时被以下三方加载）：
 *  - scripts/validate-examples.mjs：本地命令 / predev / prebuild 钩子
 *  - vite-plugin-examples.mjs：dev 启动与 build 时的强校验
 *  - src/core/loadExamples.ts：浏览器运行时降级判断
 *
 * 业务侧只通过这里的规则读取数据，不允许在业务代码里另写一套判断。
 *
 * @typedef {import('./validator.d.mts').ValidationIssue} ValidationIssue
 */

/** 受管数据文件清单：业务代码按此清单统一读取，新增文件只需改这里 */
export const DATA_FILES = /** @type {const} */ ([
  { file: 'schema.json', kind: 'schema', label: '表结构示例' },
  { file: 'templates.json', kind: 'templates', label: 'SQL 模板' },
])

const IDENT_RE = /^[a-zA-Z_]\w*$/

/**
 * @param {string} level
 * @param {string} file
 * @param {string} path
 * @param {string} message
 * @returns {ValidationIssue}
 */
function issue(level, file, path, message) {
  return { level, file, path, message }
}

/**
 * 从 SQL 文本中提取引用到的表名（FROM/JOIN/INTO/UPDATE），统一小写。
 * 与 store 中的解析规则保持一致，避免运行时与校验时口径不一。
 * @param {string} sql
 * @returns {string[]}
 */
export function extractReferencedTables(sql) {
  const re = /(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_]\w*)/gi
  return Array.from(String(sql).matchAll(re), m => m[1].toLowerCase())
}

/**
 * 解析并校验 schema.json。
 * @param {unknown} data
 * @param {string} [file]
 * @returns {ValidationIssue[]}
 */
export function validateSchema(data, file = 'schema.json') {
  /** @type {ValidationIssue[]} */
  const issues = []
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    issues.push(issue('error', file, '$', '根节点必须是对象，包含 version 与 tables 字段'))
    return issues
  }
  const root = /** @type {Record<string, unknown>} */ (data)

  if (typeof root.version !== 'number') {
    issues.push(issue('error', file, 'version', '字段缺失或类型错误：version 必须是数字'))
  }
  if (!Array.isArray(root.tables)) {
    issues.push(issue('error', file, 'tables', '字段缺失或类型错误：tables 必须是数组'))
    return issues
  }
  if (root.tables.length === 0) {
    issues.push(issue('error', file, 'tables', '至少需要一张示例表'))
  }

  /** @type {Set<string>} */
  const tableNames = new Set()
  root.tables.forEach((rawTable, ti) => {
    const base = `tables[${ti}]`
    if (typeof rawTable !== 'object' || rawTable === null) {
      issues.push(issue('error', file, base, '表定义必须是对象'))
      return
    }
    const table = /** @type {Record<string, unknown>} */ (rawTable)

    if (typeof table.name !== 'string' || !table.name.trim()) {
      issues.push(issue('error', file, `${base}.name`, '字段缺失：表必须包含非空 name'))
    } else if (!IDENT_RE.test(table.name)) {
      issues.push(issue('error', file, `${base}.name`, `表名 "${table.name}" 非法，需匹配 ${IDENT_RE}`))
    } else if (tableNames.has(table.name.toLowerCase())) {
      issues.push(issue('error', file, `${base}.name`, `表名重名：${table.name}`))
    } else {
      tableNames.add(table.name.toLowerCase())
    }

    if (typeof table.rowCount !== 'number' || table.rowCount < 0 || !Number.isFinite(table.rowCount)) {
      issues.push(issue('error', file, `${base}.rowCount`, '字段缺失或非法：rowCount 必须是不小于 0 的数字'))
    }

    if (!Array.isArray(table.columns)) {
      issues.push(issue('error', file, `${base}.columns`, '字段缺失或类型错误：columns 必须是数组'))
    } else if (table.columns.length === 0) {
      issues.push(issue('error', file, `${base}.columns`, `表 ${table.name ?? `#${ti}`} 至少需要一列`))
    } else {
      /** @type {Set<string>} */
      const colNames = new Set()
      table.columns.forEach((rawCol, ci) => {
        const cpath = `${base}.columns[${ci}]`
        if (typeof rawCol !== 'object' || rawCol === null) {
          issues.push(issue('error', file, cpath, '列定义必须是对象'))
          return
        }
        const col = /** @type {Record<string, unknown>} */ (rawCol)
        if (typeof col.name !== 'string' || !col.name.trim()) {
          issues.push(issue('error', file, `${cpath}.name`, '字段缺失：列必须包含非空 name'))
        } else if (colNames.has(col.name.toLowerCase())) {
          issues.push(issue('error', file, `${cpath}.name`, `表 ${table.name} 中列名重名：${col.name}`))
        } else {
          colNames.add(col.name.toLowerCase())
        }
        if (typeof col.type !== 'string' || !col.type.trim()) {
          issues.push(issue('error', file, `${cpath}.type`, '字段缺失：列必须包含非空 type'))
        }
        if (col.fk !== undefined && typeof col.fk !== 'string') {
          issues.push(issue('error', file, `${cpath}.fk`, 'fk 必须是 "表名.列名" 形式的字符串'))
        }
      })
    }
  })

  // 外键引用检查（依赖第一轮收集到的表名与列名，故单独再走一遍）
  root.tables.forEach((rawTable, ti) => {
    if (typeof rawTable !== 'object' || rawTable === null || !Array.isArray(rawTable.columns)) return
    const table = /** @type {Record<string, any>} */ (rawTable)
    table.columns.forEach((/** @type {Record<string, unknown>} */ col, ci) => {
      if (typeof col.fk !== 'string') return
      const cpath = `tables[${ti}].columns[${ci}].fk`
      const parts = col.fk.split('.')
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        issues.push(issue('error', file, cpath, `外键 "${col.fk}" 格式非法，应为 "表名.列名"`))
        return
      }
      const [refTable, refCol] = parts.map(p => p.toLowerCase())
      if (!tableNames.has(refTable)) {
        issues.push(issue('error', file, cpath, `外键 "${col.fk}" 引用的表 ${refTable} 不存在`))
        return
      }
      const target = root.tables.find(
        (/** @type {Record<string, any>} */ t) => String(t.name).toLowerCase() === refTable,
      )
      const hasCol = Array.isArray(target?.columns)
        && target.columns.some((/** @type {{name?: unknown}} */ c) => String(c.name).toLowerCase() === refCol)
      if (!hasCol) {
        issues.push(issue('error', file, cpath, `外键 "${col.fk}" 引用的列 ${refTable}.${refCol} 不存在`))
      }
    })
  })

  return issues
}

/**
 * 校验 templates.json 的自身结构（字段缺失、模板重名等），
 * 不检查“引用的表是否存在”——那属于跨文件校验，见 validateTemplateTableRefs。
 * @param {unknown} data
 * @param {string} [file]
 * @returns {ValidationIssue[]}
 */
export function validateTemplatesStructure(data, file = 'templates.json') {
  /** @type {ValidationIssue[]} */
  const issues = []
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    issues.push(issue('error', file, '$', '根节点必须是对象，包含 version 与 templates 字段'))
    return issues
  }
  const root = /** @type {Record<string, unknown>} */ (data)

  if (typeof root.version !== 'number') {
    issues.push(issue('error', file, 'version', '字段缺失或类型错误：version 必须是数字'))
  }
  if (!Array.isArray(root.templates)) {
    issues.push(issue('error', file, 'templates', '字段缺失或类型错误：templates 必须是数组'))
    return issues
  }
  if (root.templates.length === 0) {
    issues.push(issue('error', file, 'templates', '至少需要一个 SQL 模板'))
  }

  /** @type {Set<string>} */
  const names = new Set()
  root.templates.forEach((rawTpl, i) => {
    const base = `templates[${i}]`
    if (typeof rawTpl !== 'object' || rawTpl === null) {
      issues.push(issue('error', file, base, '模板定义必须是对象'))
      return
    }
    const tpl = /** @type {Record<string, unknown>} */ (rawTpl)

    if (typeof tpl.name !== 'string' || !tpl.name.trim()) {
      issues.push(issue('error', file, `${base}.name`, '字段缺失：模板必须包含非空 name'))
    } else if (names.has(tpl.name)) {
      issues.push(issue('error', file, `${base}.name`, `SQL 模板重名：${tpl.name}`))
    } else {
      names.add(tpl.name)
    }

    if (typeof tpl.sql !== 'string' || !tpl.sql.trim()) {
      issues.push(issue('error', file, `${base}.sql`, `字段缺失：模板 ${tpl.name ?? `#${i}`} 必须包含非空 sql`))
    }

    if (tpl.description !== undefined && typeof tpl.description !== 'string') {
      issues.push(issue('error', file, `${base}.description`, 'description 必须是字符串'))
    }
  })

  return issues
}

/**
 * 跨文件校验：模板 SQL 中引用的表必须存在于 schema。
 * @param {{templates: Array<{name?: unknown, sql?: unknown}>}} data
 * @param {string[]} schemaTableNames schema 中合法的表名（小写）
 * @param {string} [file]
 * @returns {ValidationIssue[]}
 */
export function validateTemplateTableRefs(data, schemaTableNames, file = 'templates.json') {
  /** @type {ValidationIssue[]} */
  const issues = []
  const knownTables = new Set(schemaTableNames)
  if (!data || !Array.isArray(data.templates)) return issues
  data.templates.forEach((tpl, i) => {
    if (typeof tpl.sql !== 'string') return
    for (const refTable of extractReferencedTables(tpl.sql)) {
      if (!knownTables.has(refTable)) {
        issues.push(issue('error', file, `templates[${i}].sql`, `模板 "${tpl.name}" 引用的表 ${refTable} 在 schema 中不存在`))
      }
    }
  })
  return issues
}

/**
 * 模板的完整校验：结构 + 跨文件表引用（供命令行与构建插件一次调全）。
 * @param {unknown} data
 * @param {string[]} schemaTableNames
 * @param {string} [file]
 * @returns {ValidationIssue[]}
 */
export function validateTemplates(data, schemaTableNames, file = 'templates.json') {
  return [
    ...validateTemplatesStructure(data, file),
    ...validateTemplateTableRefs(
      /** @type {{templates: Array<{name?: unknown, sql?: unknown}>}} */ (data),
      schemaTableNames,
      file,
    ),
  ]
}

/**
 * 解析单个数据文件的原始文本（JSON 损坏在此被捕获，不抛异常）。
 * @param {string} file
 * @param {string} rawText
 * @returns {{ok: true, data: unknown} | {ok: false, data: null, issues: ValidationIssue[]}}
 */
export function parseDataFile(file, rawText) {
  try {
    return { ok: true, data: JSON.parse(rawText) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      data: null,
      issues: [issue('error', file, '$', `数据文件已损坏，JSON 解析失败：${message}`)],
    }
  }
}

/** 是否存在阻断性错误 */
export function hasErrors(issues) {
  return issues.some(i => i.level === 'error')
}

/**
 * 将问题列表渲染成终端/页面均可展示的文本行。
 * @param {ValidationIssue[]} issues
 * @returns {string[]}
 */
export function formatIssues(issues) {
  return issues.map(i =>
    `${i.level === 'error' ? '✖ ERROR' : '⚠ WARN '} [${i.file}] ${i.path === '$' ? '' : i.path + ' '}— ${i.message}`,
  )
}
