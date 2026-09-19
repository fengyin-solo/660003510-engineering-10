/**
 * 示例数据校验核心（同构：浏览器与 Node 共用，无任何运行时依赖）。
 *
 * 统一的数据读取规则：
 *   manifest.json 登记有哪些数据文件，业务代码/构建脚本只按清单加载，
 *   随后调用本模块进行解析与校验，禁止把示例数据硬编码进业务代码。
 *
 * 校验覆盖：字段缺失、类型错误、重名/重 id、FK 引用的表或列不存在、
 * 模板 SQL 引用的表不存在、JSON 文件损坏等。
 */

/** 记录一条数据来源于哪个数据文件，用于展示与导出追溯 */
export const SOURCE = Symbol('dataSourceFile')

export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0
}

/** 从 SQL 文本中提取 FROM/JOIN/INTO/UPDATE 后引用的表名（小写比较） */
export function extractTableNames(sql) {
  if (!isNonEmptyString(sql)) return []
  const matches = sql.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_]\w*)/gi)
  return Array.from(matches, m => m[1].toLowerCase())
}

const KINDS = new Set(['schema', 'templates'])

/**
 * @param {unknown} raw 已解析的 manifest JSON
 * @param {string} file 文件名（用于错误定位）
 * @returns {Array<{severity:'error'|'warning', file:string, code:string, message:string}>}
 */
export function validateManifest(raw, file = 'manifest.json') {
  const issues = []
  const push = (code, message, severity = 'error') => issues.push({ severity, file, code, message })

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    push('MANIFEST_SHAPE', '清单根节点必须是对象，且包含 files 数组')
    return issues
  }
  const files = raw.files
  if (!Array.isArray(files) || files.length === 0) {
    push('MANIFEST_FILES_MISSING', 'files 缺失或不是非空数组，无法确定要加载哪些数据文件')
    return issues
  }

  const seenIds = new Set()
  const seenPaths = new Set()
  files.forEach((entry, i) => {
    const where = `files[${i}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      push('MANIFEST_ENTRY_SHAPE', `${where} 必须是对象`)
      return
    }
    if (!isNonEmptyString(entry.id)) push('FIELD_MISSING', `${where}.id 缺失或不是非空字符串`)
    else if (seenIds.has(entry.id)) push('MANIFEST_DUPLICATE_ID', `${where}.id "${entry.id}" 重复`)
    else seenIds.add(entry.id)

    if (!isNonEmptyString(entry.file)) push('FIELD_MISSING', `${where}.file 缺失或不是非空字符串`)
    else if (seenPaths.has(entry.file)) push('MANIFEST_DUPLICATE_FILE', `${where}.file "${entry.file}" 在清单中被重复登记`)
    else seenPaths.add(entry.file)

    if (!isNonEmptyString(entry.kind) || !KINDS.has(entry.kind)) {
      push('FIELD_INVALID', `${where}.kind 缺失或非法（只允许 schema / templates）`)
    }
    if (entry.required !== undefined && typeof entry.required !== 'boolean') {
      push('FIELD_INVALID', `${where}.required 必须是布尔值`)
    }
  })

  if (!issues.some(x => x.severity === 'error')) {
    for (const kind of KINDS) {
      if (!files.some(f => f.kind === kind)) push('MANIFEST_KIND_MISSING', `清单中没有 kind 为 ${kind} 的数据文件`)
    }
  }
  return issues
}

/**
 * 校验 schema 数据文件。
 * @returns 问题列表（无问题时为空数组）
 */
export function validateSchema(raw, file = 'schema.json') {
  const issues = []
  const push = (code, message, severity = 'error') => issues.push({ severity, file, code, message })

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    push('SCHEMA_SHAPE', '根节点必须是对象，且包含 tables 数组')
    return issues
  }
  const tables = raw.tables
  if (!Array.isArray(tables) || tables.length === 0) {
    push('FIELD_MISSING', 'tables 缺失或不是非空数组')
    return issues
  }

  const tableNames = new Set()
  tables.forEach((t, i) => {
    const where = `tables[${i}]`
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      push('SCHEMA_TABLE_SHAPE', `${where} 必须是对象`)
      return
    }
    if (!isNonEmptyString(t.name)) {
      push('FIELD_MISSING', `${where}.name 缺失或不是非空字符串`)
    } else if (tableNames.has(t.name)) {
      push('SCHEMA_DUPLICATE_TABLE', `表名 "${t.name}" 重复`)
    } else {
      tableNames.add(t.name)
    }
    if (typeof t.rowCount !== 'number' || !Number.isFinite(t.rowCount) || t.rowCount < 0) {
      push('FIELD_MISSING', `${where}（表 ${t.name ?? '?'}）rowCount 缺失或不是非负数`)
    }
    if (!Array.isArray(t.columns) || t.columns.length === 0) {
      push('FIELD_MISSING', `${where}（表 ${t.name ?? '?'}）columns 缺失或不是非空数组`)
    }
  })

  // 列级校验（含 FK 引用），依赖第一趟收集到的表名
  tables.forEach((t, i) => {
    if (!t || !Array.isArray(t.columns) || !isNonEmptyString(t.name)) return
    const where = `tables[${i}]`
    const columnNames = new Set()
    t.columns.forEach((c, j) => {
      const cWhere = `${where}.columns[${j}]`
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        push('SCHEMA_COLUMN_SHAPE', `${cWhere} 必须是对象`)
        return
      }
      if (!isNonEmptyString(c.name)) push('FIELD_MISSING', `${cWhere}.name 缺失或不是非空字符串`)
      else if (columnNames.has(c.name)) push('SCHEMA_DUPLICATE_COLUMN', `表 "${t.name}" 中列名 "${c.name}" 重复`)
      else columnNames.add(c.name)

      if (!isNonEmptyString(c.type)) push('FIELD_MISSING', `${cWhere}（${t.name}.${c.name ?? '?'}）type 缺失或不是非空字符串`)
      if (c.pk !== undefined && typeof c.pk !== 'boolean') push('FIELD_INVALID', `${cWhere}.pk 必须是布尔值`)

      if (c.fk !== undefined && c.fk !== null) {
        if (!isNonEmptyString(c.fk)) {
          push('FIELD_INVALID', `${cWhere}（${t.name}.${c.name ?? '?'}）fk 必须是 "表.列" 形式的字符串`)
        } else {
          const dot = c.fk.indexOf('.')
          const refTable = dot > 0 ? c.fk.slice(0, dot) : ''
          const refColumn = dot > 0 ? c.fk.slice(dot + 1) : ''
          if (!refTable || !refColumn) {
            push('FIELD_INVALID', `${cWhere} fk "${c.fk}" 格式应为 表名.列名`)
          } else if (!tableNames.has(refTable)) {
            push('FK_TABLE_NOT_FOUND', `${t.name}.${c.name} 引用了不存在的表 "${refTable}"（fk: ${c.fk}）`)
          }
        }
      }
    })
  })

  // 第二趟：被引用表存在时，再校验被引用列是否存在
  const byName = new Map()
  for (const t of tables) {
    if (t && isNonEmptyString(t.name) && Array.isArray(t.columns)) byName.set(t.name, t)
  }
  for (const t of tables) {
    if (!t || !Array.isArray(t.columns) || !isNonEmptyString(t.name)) continue
    for (const c of t.columns) {
      if (!c || !isNonEmptyString(c.fk)) continue
      const dot = c.fk.indexOf('.')
      if (dot <= 0) continue
      const refTable = c.fk.slice(0, dot)
      const refColumn = c.fk.slice(dot + 1)
      const target = byName.get(refTable)
      if (target && !target.columns.some(x => x && x.name === refColumn)) {
        issues.push({ severity: 'error', file, code: 'FK_COLUMN_NOT_FOUND',
          message: `${t.name}.${c.name} 引用了 ${c.fk}，但表 "${refTable}" 中不存在列 "${refColumn}"` })
      }
    }
  }

  return issues
}

/**
 * 校验模板数据文件；引用的表必须存在于 schema 中。
 * @param tableNames 已通过校验的 schema 表名集合（小写）
 */
export function validateTemplates(raw, tableNames, file = 'templates.json') {
  const issues = []
  const push = (code, message, severity = 'error') => issues.push({ severity, file, code, message })

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    push('TEMPLATES_SHAPE', '根节点必须是对象，且包含 templates 数组')
    return issues
  }
  const templates = raw.templates
  if (!Array.isArray(templates) || templates.length === 0) {
    push('FIELD_MISSING', 'templates 缺失或不是非空数组')
    return issues
  }

  const knownTables = tableNames instanceof Set ? tableNames : new Set(tableNames || [])
  const seenIds = new Set()
  const seenNames = new Set()
  templates.forEach((t, i) => {
    const where = `templates[${i}]`
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      push('TEMPLATE_SHAPE', `${where} 必须是对象`)
      return
    }
    const label = isNonEmptyString(t.id) ? t.id : isNonEmptyString(t.name) ? t.name : `#${i}`
    if (!isNonEmptyString(t.id)) push('FIELD_MISSING', `${where}.id 缺失或不是非空字符串`)
    else if (seenIds.has(t.id)) push('TEMPLATE_DUPLICATE_ID', `模板 id "${t.id}" 重复`)
    else seenIds.add(t.id)

    if (!isNonEmptyString(t.name)) push('FIELD_MISSING', `${where}（${label}）name 缺失或不是非空字符串`)
    else if (seenNames.has(t.name)) push('TEMPLATE_DUPLICATE_NAME', `模板重名："${t.name}"`)
    else seenNames.add(t.name)

    if (!isNonEmptyString(t.sql)) {
      push('FIELD_MISSING', `${where}（${label}）sql 缺失或不是非空字符串`)
      return
    }
    const referenced = extractTableNames(t.sql)
    if (referenced.length === 0) {
      push('TEMPLATE_NO_TABLE', `模板 "${label}" 的 SQL 中没有解析到任何表引用`)
    }
    for (const name of referenced) {
      if (!knownTables.has(name)) {
        push('TEMPLATE_TABLE_NOT_FOUND', `模板 "${label}" 的 SQL 引用了不存在的表 "${name}"`)
      }
    }
  })

  return issues
}

/** 解析单个数据文件文本；JSON 损坏时返回带问题的结果 */
export function parseDataFile(text, file) {
  try {
    return { ok: true, data: JSON.parse(text) }
  } catch (err) {
    return {
      ok: false,
      issues: [{ severity: 'error', file, code: 'JSON_PARSE_ERROR',
        message: `数据文件损坏，无法解析为 JSON：${err && err.message ? err.message : err}` }]
    }
  }

}

/**
 * 按清单组装并校验全部数据。浏览器加载器与 Node 校验脚本共用此规则。
 *
 * @param {object} params
 * @param {unknown} params.manifest 已解析的 manifest
 * @param {Array<{id?:string, kind?:string, file?:string, required?:boolean,
 *                text?:string|null, readError?:string|null}>} params.entries
 *        每个清单条目对应的原始读取结果（文本或读取错误）
 * @returns {{issues: Array, dataset: {schemaFile:string, templatesFile:string,
 *            tables: Array, templates: Array} | null}}
 */
export function assembleDataset({ manifest, entries }) {
  const issues = validateManifest(manifest, 'manifest.json')
  const manifestBroken = issues.some(x => x.severity === 'error')

  const parsed = new Map()
  if (!manifestBroken) {
    for (const entry of manifest.files) {
      const result = entries.find(e => e && e.id === entry.id)
      if (!result || result.readError || typeof result.text !== 'string') {
        const detail = result && result.readError ? `：${result.readError}` : '：文件无法读取'
        if (entry.required !== false) {
          issues.push({ severity: 'error', file: entry.file, code: 'DATA_FILE_UNREADABLE',
            message: `清单声明的数据文件 ${entry.file} 读取失败${detail}` })
        }
        continue
      }
      const parsedFile = parseDataFile(result.text, entry.file)
      if (!parsedFile.ok) {
        issues.push(...parsedFile.issues)
        continue
      }
      parsed.set(entry.kind, { file: entry.file, data: parsedFile.data })
    }
  }

  const schemaEntry = parsed.get('schema')
  const templatesEntry = parsed.get('templates')

  let tables = []
  let tableNames = new Set()
  if (schemaEntry) {
    const schemaIssues = validateSchema(schemaEntry.data, schemaEntry.file)
    issues.push(...schemaIssues)
    // 即使 schema 还有其他错误，也尽量收集实际存在的表名，
    // 避免模板校验产生大量“表不存在”的连带误报
    const rawTables = Array.isArray(schemaEntry.data?.tables) ? schemaEntry.data.tables : []
    // 仅过滤掉结构明显不合法的条目；重名表保留，重复问题仍由 validateSchema 报错
    tables = rawTables.filter(t => t && isNonEmptyString(t.name) && Array.isArray(t.columns))
    tableNames = new Set(tables.map(t => t.name.toLowerCase()))
    if (!schemaIssues.some(x => x.severity === 'error')) {
      for (const t of tables) t[SOURCE] = schemaEntry.file
    }  }

  let templates = []
  if (templatesEntry) {
    const templateIssues = validateTemplates(templatesEntry.data, tableNames, templatesEntry.file)
    issues.push(...templateIssues)
    if (!templateIssues.some(x => x.severity === 'error') && Array.isArray(templatesEntry.data.templates)) {
      templates = templatesEntry.data.templates
      for (const t of templates) t[SOURCE] = templatesEntry.file
    }
  }

  const hasErrors = issues.some(x => x.severity === 'error') || manifestBroken
  return {
    issues,
    dataset: hasErrors ? null : {
      schemaFile: schemaEntry.file,
      templatesFile: templatesEntry.file,
      tables,
      templates
    }
  }
}

/** 取数据对象被标注的来源文件名（供 UI 与导出使用） */
export function getSourceOf(obj) {
  return (obj && obj[SOURCE]) || null
}

/** 将问题列表格式化成多行可读文本（CLI 与浏览器控制台共用） */
export function formatIssues(issues) {
  const lines = []
  for (const x of issues) {
    lines.push(`  [${x.severity.toUpperCase()}] ${x.file}  ${x.code}\n      ${x.message}`)
  }
  return lines.join('\n')
}
