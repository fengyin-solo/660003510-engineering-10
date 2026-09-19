/**
 * 示例库运行时统一加载器。
 *
 * 读取规则（业务代码只通过本模块获取示例数据，不直接 import 数据文件）：
 *  1. 一律按 data/schema.json、data/templates.json 这两个固定路径读取外部数据；
 *  2. 文件拉取失败 / JSON 损坏 / 结构校验不过 / 模板引用了不存在的表，
 *     都视为该文件不可用，自动回退到随包发布的内置副本（src/data/builtin）；
 *  3. 任何回退都会带上原始问题列表与数据来源（origin/sourceFile），
 *     页面据此给出可恢复说明，不允许白屏；
 *  4. 外部文件与内置副本同时不可用时，抛出带明确修复指引的致命错误。
 */
import * as V from './validator.mjs'
import type {
  LoadedExamples,
  DataProvenance,
  SchemaFile,
  TemplateFile,
  ValidationIssue,
} from './types'
import builtinSchemaJson from '../data/builtin/schema.json'
import builtinTemplatesJson from '../data/builtin/templates.json'

const BASE = import.meta.env.BASE_URL || '/'

function dataUrl(file: string) {
  return `${BASE.replace(/\/+$/, '')}/data/${file}`
}

/** 内置副本的仓库内路径，仅用于错误提示与导出溯源 */
export const BUILTIN_PATH: Record<'schema.json' | 'templates.json', string> = {
  'schema.json': 'src/data/builtin/schema.json',
  'templates.json': 'src/data/builtin/templates.json',
}

async function fetchExternal(file: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const res = await fetch(dataUrl(file), { cache: 'no-store' })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` }
    return { ok: true, text: await res.text() }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

interface Candidate {
  /** 外部文件解析后的结构（结构校验通过时存在） */
  external: unknown | null
  /** 最终采用的数据结构（external 或 builtin） */
  data: unknown
  origin: 'external' | 'builtin'
  /** 为什么没有采用外部文件（回退时有值） */
  fallbackReason: ValidationIssue[]
}

function makeProvenance(file: string, candidate: Candidate): DataProvenance {
  return {
    sourceFile: `data/${file}`,
    origin: candidate.origin,
    issues: candidate.fallbackReason,
  }
}

/**
 * 加载并校验完整示例库。
 * 不会因数据问题抛异常（除非外部与内置副本同时不可用），
 * 返回结果中的 degraded/issues 供页面展示恢复说明。
 */
export async function loadExamples(): Promise<LoadedExamples> {
  const descriptors = V.DATA_FILES
  const builtinJson: Record<string, unknown> = {
    'schema.json': builtinSchemaJson,
    'templates.json': builtinTemplatesJson,
  }

  // ---- 第一步：逐文件读取外部数据，结构不过则回退内置副本 ----
  const candidates: Record<string, Candidate> = {}

  for (const desc of descriptors) {
    const file = desc.file
    const fetched = await fetchExternal(file)
    const externalIssues: ValidationIssue[] = []
    let externalData: unknown = null

    if (!fetched.ok) {
      externalIssues.push({
        level: 'error',
        file,
        path: '$',
        message: `无法读取数据文件 data/${file}（${fetched.reason}）`,
      })
    } else {
      const parsed = V.parseDataFile(file, fetched.text)
      if (!parsed.ok) {
        externalIssues.push(...parsed.issues)
      } else {
        externalData = parsed.data
        const structural
          = file === 'schema.json'
            ? V.validateSchema(externalData, file)
            : V.validateTemplatesStructure(externalData, file) // 跨文件引用在第二步统一检查
        const structuralErrors = structural.filter(i => i.level === 'error')
        if (structuralErrors.length) externalIssues.push(...structuralErrors)
      }
    }

    // 校验内置副本（正常情况下构建期已保证其合法）：
    // schema 只查结构；模板直接与内置 schema 做完整校验，保证兜底集合自洽
    const builtinSchemaTables = (builtinJson['schema.json'] as SchemaFile)?.tables
    const builtinSchemaNames = Array.isArray(builtinSchemaTables)
      ? builtinSchemaTables.map(t => String(t.name).toLowerCase())
      : []
    const builtinIssues
      = file === 'schema.json'
        ? V.validateSchema(builtinJson[file], file)
        : V.validateTemplates(builtinJson[file], builtinSchemaNames, file)
    const builtinHasErrors = builtinIssues.some(i => i.level === 'error')

    const externalUsable = externalIssues.every(i => i.level !== 'error') && externalData !== null

    if (externalUsable) {
      candidates[file] = { external: externalData, data: externalData as unknown, origin: 'external', fallbackReason: [] }
    } else if (!builtinHasErrors) {
      candidates[file] = { external: null, data: builtinJson[file], origin: 'builtin', fallbackReason: externalIssues }
    } else {
      // 外部文件与内置副本同时不可用 —— 无法恢复，交给页面展示致命说明
      throw new ExampleDataFatalError(file, [...externalIssues, ...builtinIssues])
    }
  }

  // ---- 第二步：跨文件校验（模板引用的表必须在最终采用的 schema 中存在） ----
  // 内置模板与内置 schema 是配套自洽的（构建期 strict 校验保证）。
  // 一旦发现“模板 ↔ schema”对不上，整组示例库一起回退内置集合，
  // 避免出现“内置模板 + 精简外部 schema”这种半自洽状态。
  const schemaCandidate = candidates['schema.json']
  const templatesCandidate = candidates['templates.json']
  const schemaData = schemaCandidate.data as SchemaFile
  const tableNames = Array.isArray(schemaData.tables)
    ? schemaData.tables.map(t => String(t.name).toLowerCase())
    : []

  const crossIssues = V.validateTemplateTableRefs(templatesCandidate.data as TemplateFile, tableNames, 'templates.json')
  if (crossIssues.some(i => i.level === 'error')) {
    const builtinSchema = builtinJson['schema.json'] as SchemaFile
    const builtinTables = Array.isArray(builtinSchema.tables)
      ? builtinSchema.tables.map(t => String(t.name).toLowerCase())
      : []
    const builtinCross = V.validateTemplateTableRefs(builtinJson['templates.json'] as TemplateFile, builtinTables, 'templates.json')

    if (!builtinCross.some(i => i.level === 'error')) {
      // 模板回退
      templatesCandidate.data = builtinJson['templates.json']
      templatesCandidate.origin = 'builtin'
      templatesCandidate.fallbackReason.push(
        ...crossIssues.map(i => ({ ...i, message: `${i.message}（已回退到内置模板）` })),
      )
      // 若当前 schema 不是内置 schema（表集合与内置模板不配套），连带 schema 一起回退
      if (schemaCandidate.origin !== 'builtin') {
        schemaCandidate.data = builtinJson['schema.json']
        schemaCandidate.origin = 'builtin'
        schemaCandidate.fallbackReason.push({
          level: 'warning',
          file: 'schema.json',
          path: '$',
          message: '外部 schema 与模板集合不自洽，已随模板一并回退到内置副本',
        })
      }
    }
  }

  const schemaSource = makeProvenance('schema.json', schemaCandidate)
  const templatesSource = makeProvenance('templates.json', templatesCandidate)

  // 回退原因里补充文件来源说明，便于页面直接展示
  if (schemaSource.origin === 'builtin' && schemaSource.issues.length) {
    schemaSource.issues.push({
      level: 'warning',
      file: 'schema.json',
      path: '$',
      message: `已临时改用内置副本 ${BUILTIN_PATH['schema.json']} 启动，修复 data/schema.json 后刷新即可恢复`,
    })
  }
  if (templatesSource.origin === 'builtin' && templatesSource.issues.length) {
    templatesSource.issues.push({
      level: 'warning',
      file: 'templates.json',
      path: '$',
      message: `已临时改用内置副本 ${BUILTIN_PATH['templates.json']} 启动，修复 data/templates.json 后刷新即可恢复`,
    })
  }

  const finalSchema = schemaCandidate.data as SchemaFile
  const finalTemplates = templatesCandidate.data as TemplateFile
  const issues = [...schemaSource.issues, ...templatesSource.issues]

  return {
    schema: Array.isArray(finalSchema.tables) ? finalSchema.tables : [],
    templates: Array.isArray(finalTemplates.templates) ? finalTemplates.templates : [],
    schemaSource,
    templatesSource,
    degraded: schemaSource.origin === 'builtin' || templatesSource.origin === 'builtin',
    issues,
  }
}

/** 致命错误：外部数据与内置副本均不可用，页面必须给出可恢复说明而非白屏 */
export class ExampleDataFatalError extends Error {
  file: string
  issues: ValidationIssue[]
  constructor(file: string, issues: ValidationIssue[]) {
    super(`示例数据文件 ${file} 已损坏，且内置兜底副本也不可用，应用无法启动`)
    this.name = 'ExampleDataFatalError'
    this.file = file
    this.issues = issues
  }
}
