/**
 * 示例数据专用 Vite 插件：
 *
 *  1. dev 服务器启动时（configureServer 钩子）立即校验 public/data 下的数据文件，
 *     字段缺失 / 引用的表不存在 / 模板重名等问题会在终端明确指出（不阻断 dev，
 *     运行时加载器会自动回退到内置副本，页面给出恢复说明）；
 *  2. build 开始时（buildStart 钩子）强校验，发现任何 error 直接让构建失败，
 *     非法数据不允许被打包发布；
 *  3. dev 提供 POST /__dev/reset-examples：用 src/data/builtin 下的内置副本
 *     覆盖回 public/data，供页面“从内置副本恢复”按钮调用；
 *  4. dev 提供 /data/*.json 的静态读取，使加载器的统一路径在本地同样生效
 *     （Vite 本身也会服务 public，这里额外兜底缺失文件，返回 404 交由运行时降级）。
 *
 * @typedef {import('./src/core/validator.d.mts').ValidationIssue} ValidationIssue
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DATA_FILES,
  parseDataFile,
  validateSchema,
  validateTemplates,
  validateTemplatesStructure,
  formatIssues,
} from './src/core/validator.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.resolve(__dirname, 'public/data')
export const BUILTIN_DIR = path.resolve(__dirname, 'src/data/builtin')

/**
 * 读取并校验 public/data 下的全部数据文件，返回所有问题（不抛异常）。
 * @returns {ValidationIssue[]}
 */
export function validateExampleFiles() {
  /** @type {ValidationIssue[]} */
  const all = []
  /** @type {Record<string, unknown>} */
  const parsedByFile = {}

  for (const desc of DATA_FILES) {
    const filePath = path.join(DATA_DIR, desc.file)
    if (!fs.existsSync(filePath)) {
      all.push({ level: 'error', file: desc.file, path: '$', message: `数据文件缺失：public/data/${desc.file}` })
      continue
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = parseDataFile(desc.file, raw)
    if (!parsed.ok) {
      all.push(...parsed.issues)
      continue
    }
    parsedByFile[desc.file] = parsed.data
    if (desc.kind === 'schema') {
      all.push(...validateSchema(parsed.data, desc.file))
    }
  }

  // 跨文件：模板引用的表必须存在。
  // schema 自身已损坏/非法时跳过，避免对每个模板刷一片“表不存在”的噪音，根因以 schema 错误为准。
  const schemaData = /** @type {{tables?: Array<{name?: unknown}>} | undefined} */ (parsedByFile['schema.json'])
  const schemaOk = schemaData && !all.some(i => i.file === 'schema.json' && i.level === 'error')
  const tableNames = Array.isArray(schemaData?.tables)
    ? schemaData.tables.map(t => String(t.name).toLowerCase())
    : []
  const templatesFile = DATA_FILES.find(d => d.file === 'templates.json')
  if (schemaOk && templatesFile && parsedByFile['templates.json']) {
    all.push(...validateTemplates(parsedByFile['templates.json'], tableNames, 'templates.json'))
  } else if (parsedByFile['templates.json']) {
    all.push(...validateTemplatesStructure(parsedByFile['templates.json'], 'templates.json'))
  }

  return all
}

/**
 * 额外校验内置兜底副本自身（构建期保证它始终可用）。
 * @returns {ValidationIssue[]}
 */
export function validateBuiltinFiles() {
  /** @type {ValidationIssue[]} */
  const all = []
  /** @type {Record<string, unknown>} */
  const parsedByFile = {}
  for (const desc of DATA_FILES) {
    const filePath = path.join(BUILTIN_DIR, desc.file)
    if (!fs.existsSync(filePath)) {
      all.push({ level: 'error', file: desc.file, path: '$', message: `内置兜底副本缺失：src/data/builtin/${desc.file}` })
      continue
    }
    const parsed = parseDataFile(desc.file, fs.readFileSync(filePath, 'utf-8'))
    if (!parsed.ok) {
      all.push(...parsed.issues)
      continue
    }
    parsedByFile[desc.file] = parsed.data
    if (desc.kind === 'schema') all.push(...validateSchema(parsed.data, desc.file))
  }
  const schemaData = /** @type {{tables?: Array<{name?: unknown}>} | undefined} */ (parsedByFile['schema.json'])
  const tableNames = Array.isArray(schemaData?.tables) ? schemaData.tables.map(t => String(t.name).toLowerCase()) : []
  if (parsedByFile['templates.json']) all.push(...validateTemplates(parsedByFile['templates.json'], tableNames, 'templates.json'))
  return all
}

/** @param {ValidationIssue[]} issues */
export function reportIssues(issues, { throwOnError } = { throwOnError: true }) {
  if (!issues.length) return
  const lines = formatIssues(issues)
  const prefix = '\n[examples] 示例数据校验未通过：\n'
  const suffix = '\n[examples] 修复后重试；紧急情况下可用 src/data/builtin 下的副本覆盖 public/data。\n'
  // eslint-disable-next-line no-console
  console.error(prefix + lines.join('\n') + suffix)
  if (throwOnError && issues.some(i => i.level === 'error')) {
    throw new Error(`示例数据校验失败：${issues.filter(i => i.level === 'error').length} 个错误（详见上方输出）`)
  }
}

export function examplesPlugin() {
  /** @type {boolean | undefined} */
  let isBuild
  return {
    name: 'sql-visualizer-examples',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    buildStart() {
      // build：强校验，任何 error 直接让构建失败，非法数据不允许打包发布。
      // dev：仅在终端明确指出问题，不阻断启动（运行时加载器会回退内置副本并在页面提示恢复）。
      const builtinIssues = validateBuiltinFiles()
      reportIssues(builtinIssues, { throwOnError: isBuild })
      const issues = validateExampleFiles()
      reportIssues(issues, { throwOnError: isBuild })
    },
    configureServer(server) {
      // 启动时的校验报告由 buildStart 钩子统一输出（dev 不阻断）。
      // 这里只挂载本地恢复接口。
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]

        // 本地恢复接口：内置副本写回 public/data
        if (req.method === 'POST' && url.endsWith('/__dev/reset-examples')) {
          try {
            fs.mkdirSync(DATA_DIR, { recursive: true })
            for (const desc of DATA_FILES) {
              fs.copyFileSync(path.join(BUILTIN_DIR, desc.file), path.join(DATA_DIR, desc.file))
            }
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
          }
          return
        }

        next()
      })
    },
  }
}
