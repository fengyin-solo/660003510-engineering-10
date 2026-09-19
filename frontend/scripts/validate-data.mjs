#!/usr/bin/env node
/**
 * 示例数据本地校验脚本（开发启动与构建前门禁）。
 *
 * 读取规则与浏览器完全一致：manifest.json 声明文件列表 →
 * 逐个读取 → assembleDataset 统一解析校验。
 *
 * 用法：node scripts/validate-data.mjs [数据目录]
 * 退出码：0 通过；1 发现错误（字段缺失 / 引用表不存在 / 模板重名 / JSON 损坏等）
 */
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleDataset, formatIssues } from '../src/data/validator.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(process.argv[2] ?? resolve(here, '../public/data'))

async function readJsonText(file) {
  try {
    return { file, text: await readFile(resolve(dataDir, file), 'utf8'), readError: null }
  } catch (err) {
    return { file, text: null, readError: err && err.code === 'ENOENT' ? '文件不存在' : String(err) }
  }
}

async function main() {
  let manifestText
  try {
    manifestText = await readFile(resolve(dataDir, 'manifest.json'), 'utf8')
  } catch (err) {
    console.error(`✗ 示例数据校验失败：清单 ${resolve(dataDir, 'manifest.json')} 无法读取`)
    console.error(`  ${err && err.code === 'ENOENT' ? '文件不存在' : err}`)
    process.exit(1)
  }

  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch (err) {
    console.error('✗ 示例数据校验失败：manifest.json 已损坏，无法解析为 JSON')
    console.error(`  ${err}`)
    process.exit(1)
  }

  const declared = Array.isArray(manifest?.files) ? manifest.files : []
  const entries = await Promise.all(
    declared.map(async f => {
      const r = await readJsonText(f.file)
      return { ...f, text: r.text, readError: r.readError }
    })
  )

  const { issues } = assembleDataset({ manifest, entries })
  const errors = issues.filter(x => x.severity === 'error')
  const warnings = issues.filter(x => x.severity === 'warning')

  if (warnings.length) {
    console.warn(`⚠ 示例数据存在 ${warnings.length} 条警告：`)
    console.warn(formatIssues(warnings))
  }

  if (errors.length) {
    console.error(`\n✗ 示例数据校验失败，共 ${errors.length} 个错误（数据目录：${dataDir}）`)
    console.error(formatIssues(errors))
    console.error('\n请修复上述数据文件后重试。')
    process.exit(1)
  }

  console.log(`✓ 示例数据校验通过：${entries.length} 个数据文件（${dataDir}）`)
}

main().catch(err => {
  console.error('✗ 示例数据校验脚本异常：', err)
  process.exit(1)
})
