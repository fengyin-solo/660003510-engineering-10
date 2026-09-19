<template>
  <!-- 全屏状态：加载中或数据彻底不可用（外部文件 + 内置副本同时损坏）时展示，替代白屏 -->
  <div v-if="mode === 'overlay'" class="min-h-screen bg-slate-900 text-slate-200 flex items-center justify-center p-6">
    <div class="max-w-xl w-full bg-slate-800 border rounded-lg p-6"
      :class="kind === 'fatal' ? 'border-red-600' : 'border-slate-700'">
      <div class="flex items-center gap-3 mb-3">
        <span class="text-2xl">{{ kind === 'loading' ? '⏳' : '🧰' }}</span>
        <h2 class="text-lg font-bold" :class="kind === 'fatal' ? 'text-red-400' : 'text-cyan-400'">
          {{ kind === 'loading' ? '正在加载示例数据…' : '示例数据暂不可用' }}
        </h2>
      </div>

      <template v-if="kind === 'fatal'">
        <p class="text-sm text-slate-300 leading-6">
          示例数据文件已损坏且内置兜底副本也无法使用，应用已停止启动以免展示错误内容。
          这通常不是浏览器问题，按下面步骤即可恢复：
        </p>
        <ol class="list-decimal list-inside text-sm text-slate-300 mt-3 space-y-1.5 leading-6">
          <li>打开终端，进入 <code class="text-cyan-300">frontend</code> 目录；</li>
          <li>运行 <code class="text-cyan-300">npm run validate:examples</code> 查看具体出错的文件与字段；</li>
          <li>用 <code class="text-cyan-300">src/data/builtin/schema.json</code> 和
            <code class="text-cyan-300">src/data/builtin/templates.json</code> 覆盖修复
            <code class="text-cyan-300">public/data/</code> 下的同名文件；</li>
          <li>本地开发时也可直接点击下方“从内置副本恢复并重试”按钮。</li>
        </ol>
        <p v-if="message" class="text-xs text-red-300 mt-3 break-all">原因：{{ message }}</p>
        <ul v-if="issues.length" class="mt-3 space-y-1">
          <li v-for="(it, i) in issues" :key="i" class="text-xs text-red-300 font-mono break-all">
            ✖ [{{ it.file }}]{{ it.path && it.path !== '$' ? ' ' + it.path : '' }} — {{ it.message }}
          </li>
        </ul>
        <div class="flex gap-2 mt-5">
          <button @click="$emit('retry')"
            class="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-bold">重新加载</button>
          <button v-if="canReset" @click="$emit('reset')"
            class="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-bold">从内置副本恢复并重试</button>
        </div>
      </template>

      <template v-else>
        <p class="text-sm text-slate-400">正在按统一读取规则加载 data/schema.json 与 data/templates.json…</p>
      </template>
    </div>
  </div>

  <!-- 顶部横幅：降级模式（已用内置副本兜底）时给出可恢复说明 -->
  <div v-else-if="mode === 'banner'"
    class="bg-amber-900/40 border-b border-amber-600 px-6 py-2 text-xs text-amber-200">
    <div class="flex items-start gap-2 flex-wrap">
      <span class="font-bold">⚠ 示例数据已降级：</span>
      <span>部分数据文件缺失、损坏或非法，当前使用随包内置副本启动，功能不受影响。</span>
      <button @click="$emit('retry')" class="underline hover:text-amber-100">重新读取数据文件</button>
      <button v-if="canReset" @click="$emit('reset')" class="underline hover:text-amber-100">
        从内置副本恢复（本地开发）
      </button>
    </div>
    <ul class="mt-1.5 space-y-0.5 font-mono text-amber-300/90">
      <li v-for="(it, i) in issues" :key="i">
        {{ it.level === 'error' ? '✖' : '⚠' }} [{{ it.file }}]{{ it.path && it.path !== '$' ? ' ' + it.path : '' }} — {{ it.message }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { ValidationIssue } from '../core/types'

withDefaults(defineProps<{
  mode: 'overlay' | 'banner'
  kind?: 'loading' | 'fatal'
  message?: string
  issues?: ValidationIssue[]
  /** 是否允许调用本地开发的恢复接口（仅 dev server 存在） */
  canReset?: boolean
}>(), {
  kind: 'loading',
  message: '',
  issues: () => [],
  canReset: false,
})

defineEmits<{
  (e: 'retry'): void
  (e: 'reset'): void
}>()
</script>
