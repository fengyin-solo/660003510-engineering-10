import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { assembleDataset, formatIssues } from '../src/data/validator.js'

/**
 * 开发服务器 / 构建期的数据门禁插件。
 * - configureServer：启动即校验；数据文件改动时热校验，在终端报错并向浏览器推送错误叠加层
 * - buildStart：构建前再次校验，错误直接中断构建
 */
export function exampleDataPlugin(dataDir = resolve(process.cwd(), 'public/data')) {
  let logger
  let isServing = false
  const runValidation = () => {
    const manifestPath = resolve(dataDir, 'manifest.json')
    if (!existsSync(manifestPath)) {
      return [{ severity: 'error', file: 'manifest.json', code: 'DATA_FILE_UNREADABLE',
        message: `清单文件不存在：${manifestPath}` }]
    }
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      return [{ severity: 'error', file: 'manifest.json', code: 'JSON_PARSE_ERROR',
        message: `清单文件已损坏：${err.message}` }]
    }
    const entries = (Array.isArray(manifest?.files) ? manifest.files : []).map(f => {
      try {
        return { ...f, text: readFileSync(resolve(dataDir, f.file), 'utf8'), readError: null }
      } catch {
        return { ...f, text: null, readError: '文件不存在或无法读取' }
      }
    })
    return assembleDataset({ manifest, entries }).issues
  }

  const report = (logger, issues) => {
    const errors = issues.filter(x => x.severity === 'error')
    if (errors.length) {
      logger.error(
        `\n示例数据校验失败（${errors.length} 个错误）：\n${formatIssues(errors)}\n\n` +
        '请修复 public/data 下的数据文件；开发模式下保存文件会自动重新校验。\n',
        { error: new Error('invalid example data') }
      )
    } else {
      logger.info(`✓ 示例数据校验通过（${issues.length} 条警告）`, { timestamp: true })
    }
    return errors
  }

  return {
    name: 'example-data-guard',
    configResolved(config) {
      logger = config.logger
      isServing = config.command === 'serve'
    },
    buildStart() {
      // dev 下由 configureServer 的文件监听负责（含热校验），避免重复输出
      if (isServing) return
      const errors = report(logger, runValidation())
      if (errors.length) throw new Error('示例数据校验未通过，构建已中止（详见上方错误）')
    },
    configureServer(server) {
      const { watcher, ws } = server
      logger = server.config.logger
      watcher.add(dataDir)

      const check = (event) => {
        const errors = report(logger, runValidation())
        if (event && errors.length) {
          // 触发浏览器错误叠加层，明确提示是数据文件问题
          ws.send({
            type: 'error',
            err: {
              plugin: 'example-data-guard',
              message: `示例数据校验未通过（${errors.length} 个错误），详情与修复建议见终端`,
              stack: '',
              id: 'public/data/manifest.json',
              pluginCode: 'EXAMPLE_DATA_INVALID'
            }
          })
        }
        return errors
      }

      // 开发服务器启动即校验
      check(false)
      const isDataFile = file => file.replace(/\\/g, '/').includes('/public/data/')
      watcher.on('change', file => { if (isDataFile(file)) check('change') })
      watcher.on('add', file => { if (isDataFile(file)) check('add') })
    }
  }
}
