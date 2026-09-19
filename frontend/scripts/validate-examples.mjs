#!/usr/bin/env node
/**
 * 示例数据校验命令：
 *   node scripts/validate-examples.mjs           # 只校验 public/data
 *   node scripts/validate-examples.mjs --strict  # 同时校验内置兜底副本，任何 error 以非零码退出
 *
 * 本地开发（predev）与构建（prebuild）都会执行；CI 可直接调用本脚本。
 */
import {
  validateExampleFiles,
  validateBuiltinFiles,
  reportIssues,
} from '../vite-plugin-examples.mjs'

const strict = process.argv.includes('--strict')

const issues = validateExampleFiles()
const builtinIssues = strict ? validateBuiltinFiles() : []

reportIssues(issues, { throwOnError: false })
if (strict) reportIssues(builtinIssues, { throwOnError: false })

const errors = [...issues, ...builtinIssues].filter(i => i.level === 'error')
const warnings = [...issues, ...builtinIssues].filter(i => i.level === 'warning')

if (errors.length) {
  console.error(`\n✖ 示例数据校验失败：${errors.length} 个错误，${warnings.length} 个警告`)
  process.exit(1)
}
if (warnings.length) {
  console.warn(`\n⚠ 示例数据校验通过，但存在 ${warnings.length} 个警告`)
} else {
  console.log('\n✓ 示例数据校验通过')
}
