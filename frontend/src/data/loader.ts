/**
 * 浏览器侧示例数据加载器。
 * 统一读取规则：先拉取 manifest.json 清单，再按清单声明逐个拉取数据文件，
 * 最后交给与构建脚本完全相同的 validator.assembleDataset 做解析与校验。
 * 业务代码不允许 import 具体示例数据，只能通过本模块加载。
 */
import { assembleDataset, formatIssues } from './validator.js'
import type { Dataset, ValidationIssue } from './validator'

export class DataLoadError extends Error {
  /** 数据文件损坏/校验失败时携带的问题列表（可在 UI 上逐条展示） */
  issues: ValidationIssue[]
  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message)
    this.name = 'DataLoadError'
    this.issues = issues
  }
}

async function fetchText(url: string): Promise<{ text?: string; error?: string }> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch (err) {
    return { error: `网络请求失败（${err instanceof Error ? err.message : String(err)}）` }
  }
  if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText}` }
  return { text: await res.text() }
}

/**
 * 加载并校验全部示例数据。
 * @param base 数据目录 URL（默认取 Vite BASE_URL 下的 data/）
 */
export async function loadDataset(base?: string): Promise<Dataset> {
  const root = base ?? `${import.meta.env.BASE_URL}data/`
  const manifestUrl = `${root}manifest.json`

  const manifestResult = await fetchText(manifestUrl)
  if (manifestResult.error || typeof manifestResult.text !== 'string') {
    throw new DataLoadError(`清单文件 manifest.json 无法读取：${manifestResult.error ?? '未知错误'}`)
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(manifestResult.text)
  } catch (err) {
    throw new DataLoadError(
      '清单文件 manifest.json 已损坏，无法解析为 JSON，示例数据未能加载。',
      [{ severity: 'error', file: 'manifest.json', code: 'JSON_PARSE_ERROR',
        message: err instanceof Error ? err.message : String(err) }]
    )
  }

  const files = (manifest as { files?: Array<{ id: string; kind: string; file: string; required?: boolean }> })?.files
  if (!Array.isArray(files) || files.length === 0) {
    // 让 assembleDataset 给出统一格式的问题
    const { issues } = assembleDataset({ manifest, entries: [] })
    throw new DataLoadError('清单文件 manifest.json 内容不合法，示例数据未能加载。', issues)
  }

  const entries = await Promise.all(
    files.map(async f => {
      const { text, error } = await fetchText(`${root}${encodeURIComponent(f.file)}`)
      return { ...f, text: text ?? null, readError: error ?? null }
    })
  )

  const { issues, dataset } = assembleDataset({ manifest, entries })
  if (!dataset) {
    // 控制台同步输出，方便本地开发定位；页面上另有可恢复提示
    console.error('[example-data] 示例数据校验未通过：\n' + formatIssues(issues))
    throw new DataLoadError('示例数据存在错误，应用已暂停渲染以避免展示错误内容。', issues)
  }
  if (issues.some(x => x.severity === 'warning')) {
    console.warn('[example-data] 示例数据存在警告：\n' + formatIssues(issues.filter(x => x.severity === 'warning')))
  }
  return dataset
}
