/**
 * 示例库与 SQL 分析相关的统一类型定义。
 * 数据文件（public/data/*.json）、校验器、运行时加载器与业务 store 共用这些类型，
 * 业务代码不直接依赖具体的数据文件，只依赖这里的接口。
 */

/** 表列定义（schema.json 中 columns 的元素） */
export interface SQLColumn {
  name: string
  type: string
  /** 主键标记 */
  pk?: boolean
  /** 外键引用，格式 "表名.列名" */
  fk?: string
}

/** 表定义（schema.json 中 tables 的元素） */
export interface SQLTable {
  name: string
  columns: SQLColumn[]
  rowCount: number
}

/** SQL 模板定义（templates.json 中 templates 的元素） */
export interface SQLTemplate {
  /** 模板名称，同一数据文件内必须唯一 */
  name: string
  sql: string
  /** 可选的一句话说明 */
  description?: string
}

/** schema.json 的文件结构 */
export interface SchemaFile {
  /** 数据文件格式版本，目前固定为 1 */
  version: number
  tables: SQLTable[]
}

/** templates.json 的文件结构 */
export interface TemplateFile {
  version: number
  templates: SQLTemplate[]
}

/** 校验出的单条问题 */
export interface ValidationIssue {
  /** 错误级别：error 会阻断构建/启动，warning 仅提示 */
  level: 'error' | 'warning'
  /** 问题所在的数据文件标识，例如 schema.json / templates.json */
  file: string
  /** 人类可读的定位信息，例如 tables[2].columns[0].type */
  path: string
  message: string
}

/** 单个数据文件的解析结果 */
export interface ParsedDataFile<T> {
  file: string
  /** JSON.parse 是否成功；为 false 时 data 为 null */
  ok: boolean
  data: T | null
  issues: ValidationIssue[]
}

/** 一份示例数据（表结构或模板）的来源与降级信息 */
export interface DataProvenance {
  /** 业务侧统一读取的相对路径，例如 data/schema.json */
  sourceFile: string
  /** 实际数据来源：external=public 下可编辑文件，builtin=内置兜底副本 */
  origin: 'external' | 'builtin'
  /** 该数据上存在的校验问题（降级模式下不为空） */
  issues: ValidationIssue[]
}

/** 运行时加载完成后的示例库 */
export interface LoadedExamples {
  schema: SQLTable[]
  templates: SQLTemplate[]
  /** 每个数据文件各自的来源信息，页面据此展示“来自哪个文件” */
  schemaSource: DataProvenance
  templatesSource: DataProvenance
  /** 是否处于降级模式（至少一个文件回退到了内置副本） */
  degraded: boolean
  /** 降级/校验问题的汇总，供页面横幅展示 */
  issues: ValidationIssue[]
}

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
