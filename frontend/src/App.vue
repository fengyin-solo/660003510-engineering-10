<template>
  <ExampleStatus v-if="store.loadState !== 'ready'" :mode="'overlay'"
    :kind="store.loadState === 'loading' ? 'loading' : 'fatal'"
    :message="store.fatalMessage" :issues="store.fatalIssues" :can-reset="isDev"
    @retry="store.init()" @reset="resetAndReload" />

  <div v-else class="min-h-screen bg-slate-900 text-slate-200">
    <header class="border-b border-slate-700 px-6 py-4">
      <h1 class="text-2xl font-bold text-cyan-400">SQL 查询可视化与执行计划分析器</h1>
      <p class="text-sm text-slate-500 mt-1">SQL语法解析 · 执行计划树 · ER图 · 复杂度评分 · 优化建议</p>
    </header>

    <ExampleStatus v-if="store.degraded" :mode="'banner'" :issues="store.dataIssues" :can-reset="isDev"
      @retry="store.init()" @reset="resetAndReload" />

    <div class="flex flex-col lg:flex-row gap-4 p-4">
      <div class="lg:w-2/5 space-y-4">
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div class="flex items-center justify-between mb-3 gap-2">
            <h3 class="text-sm font-bold text-slate-400">SQL 编辑器</h3>
            <div class="flex gap-2 items-center">
              <select :value="store.selectedTemplateIndex"
                @change="(e) => store.selectTemplate(+(e.target as HTMLSelectElement).value)"
                class="text-xs bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-300">
                <option value="-1" disabled>选择示例…</option>
                <option v-for="(t, i) in store.templates" :key="t.name" :value="i">{{ t.name }}</option>
              </select>
              <button :disabled="!store.activeTemplate" @click="exportCurrent"
                title="导出当前模板（含来源数据文件信息）"
                class="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded px-2 py-1">
                导出示例
              </button>
            </div>
          </div>
          <textarea :value="store.sql" @input="onEdit" rows="12"
            class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono text-green-400 focus:outline-none focus:border-cyan-500 resize-none"></textarea>
          <button @click="store.analyze()" class="w-full mt-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-bold">分析查询</button>

          <!-- 当前内容溯源：显示来自哪个数据文件、是否已被手动修改 -->
          <div class="mt-2 text-[11px] text-slate-500 flex items-center justify-between gap-2 flex-wrap">
            <span class="font-mono">
              {{ store.activeTemplate
                ? `模板来源：${store.templatesSource?.sourceFile}#${store.activeTemplate.name}`
                : '自定义 SQL（已与模板脱钩）' }}
              <span v-if="store.activeTemplate && store.dirty" class="text-amber-400">· 已手动修改</span>
            </span>
            <button @click="exportAll" class="text-cyan-500 hover:text-cyan-300 underline">导出整个示例库</button>
          </div>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-400">数据库 Schema</h3>
            <span class="text-[11px] text-slate-600 font-mono">{{ originLabel(store.schemaSource) }}</span>
          </div>
          <div class="space-y-2">
            <div v-for="t in store.tables" :key="t.name"
              @click="store.activeSchema = store.activeSchema?.name === t.name ? null : t"
              :class="['cursor-pointer rounded border p-2 text-xs transition-all', store.activeSchema?.name === t.name ? 'border-cyan-500 bg-cyan-900/20' : 'border-slate-700 hover:border-slate-500']">
              <div class="flex justify-between items-center">
                <span class="font-bold text-slate-200">{{ t.name }}</span>
                <span class="text-slate-500">{{ t.rowCount.toLocaleString() }} 行</span>
              </div>
              <div v-if="store.activeSchema?.name === t.name" class="mt-2 space-y-0.5">
                <div v-for="c in t.columns" :key="c.name" class="flex gap-2">
                  <span :class="c.pk ? 'text-yellow-400' : c.fk ? 'text-blue-400' : 'text-slate-400'">{{ c.pk ? '🔑 ' : c.fk ? '🔗 ' : '  ' }}{{ c.name }}</span>
                  <span class="text-slate-600">{{ c.type }}</span>
                  <span v-if="c.fk" class="text-blue-600">→ {{ c.fk }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="lg:w-3/5 space-y-4">
        <div v-if="store.parsed" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">查询解析结果</h3>
          <div class="grid grid-cols-4 gap-3 text-sm mb-4">
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">类型</div><div class="text-cyan-400 font-bold">{{ store.parsed.type }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">复杂度</div><div class="font-bold" :class="store.complexityLabel.color">{{ store.complexityLabel.label }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">JOIN数</div><div class="text-orange-400 font-bold">{{ store.parsed.joins.length }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">预估行数</div><div class="text-purple-400 font-bold">{{ store.parsed.estimatedCost }}</div></div>
          </div>
          <div v-if="store.parsed.suggestions.length" class="space-y-1">
            <div class="text-xs text-slate-500 mb-1">优化建议</div>
            <div v-for="(s, i) in store.parsed.suggestions" :key="i" class="text-xs flex items-start gap-2 bg-orange-900/30 border border-orange-700 rounded p-2">
              <span class="text-orange-400">⚠</span><span class="text-orange-300">{{ s }}</span>
            </div>
          </div>
          <div v-else class="text-xs text-green-400 bg-green-900/20 border border-green-700 rounded p-2">✓ 未发现明显性能问题</div>
        </div>
        <div v-if="store.plan" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">执行计划树</h3>
          <div class="overflow-x-auto">
            <div class="font-mono text-xs text-slate-300 space-y-1">
              <PlanNode :node="store.plan" :depth="0" />
            </div>
          </div>
        </div>
        <div v-if="store.parsed" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">涉及表与关联关系</h3>
          <canvas ref="erCanvasRef" class="w-full bg-slate-900 rounded" style="height:200px"></canvas>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, defineComponent, h } from 'vue'
import { useSQLStore } from './store/sql'
import type { DataProvenance } from './core/types'
import { exportTemplate, exportLibrary } from './core/exportExample'
import ExampleStatus from './components/ExampleStatus.vue'

const store = useSQLStore()
const erCanvasRef = ref<HTMLCanvasElement | null>(null)
const isDev = import.meta.env.DEV

function originLabel(source: DataProvenance | null) {
  if (!source) return ''
  return source.origin === 'builtin'
    ? `来源：内置副本（${source.sourceFile} 已损坏）`
    : `来源：${source.sourceFile}`
}

function onEdit(e: Event) {
  store.sql = (e.target as HTMLTextAreaElement).value
  // 手动编辑即与模板脱钩，但分析结果仍与编辑内容保持同步
  store.markManualEdit()
  store.analyze()
}

function exportCurrent() {
  if (!store.activeTemplate || store.dirty) return
  exportTemplate(store.activeTemplate, store.selectedTemplateIndex, store.templatesSource!)
}

function exportAll() {
  exportLibrary({
    schema: store.tables,
    templates: store.templates,
    schemaSource: store.schemaSource!,
    templatesSource: store.templatesSource!,
  })
}

/** 本地开发恢复：由 vite 插件提供的 dev 接口把内置副本写回 public/data */
async function resetAndReload() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL || '/'}__dev/reset-examples`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await store.init()
  } catch (err) {
    alert(`恢复失败：${err instanceof Error ? err.message : err}。可手动用 src/data/builtin 下的文件覆盖 public/data。`)
  }
}

const PlanNode = defineComponent({
  props: { node: Object, depth: Number },
  setup(props) {
    return () => {
      if (!props.node) return null
      const n = props.node as any
      const indent = '  '.repeat(props.depth || 0)
      const opColor = n.operation.includes('Scan') ? '#22c55e' : n.operation.includes('Join') ? '#f97316' : n.operation.includes('Sort') ? '#8b5cf6' : '#06b6d4'
      return h('div', [
        h('div', { style: `padding-left: ${(props.depth || 0) * 20}px` }, [
          h('span', { style: 'color: #475569' }, indent.replace(/\s\s/g, '│ ').replace(/│ $/, '└─')),
          h('span', { style: `color: ${opColor}; font-weight: bold` }, n.operation),
          n.table ? h('span', { style: 'color: #94a3b8' }, ` on ${n.table}`) : null,
          n.index ? h('span', { style: 'color: #eab308' }, ` [${n.index}]`) : null,
          h('span', { style: 'color: #64748b' }, ` cost=${n.cost.toFixed(1)} rows=${n.rows}`),
        ]),
        ...(n.children || []).map((child: any) => h(PlanNode, { node: child, depth: (props.depth || 0) + 1 }))
      ])
    }
  }
})

function drawER() {
  const canvas = erCanvasRef.value
  if (!canvas || !store.parsed) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const tables = store.parsed.tables
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.clientWidth
  canvas.height = 200
  const W = canvas.width, H = 200
  const spacing = W / (tables.length + 1)
  const positions: Record<string, { x: number; y: number }> = {}
  tables.forEach((t, i) => { positions[t] = { x: spacing * (i + 1), y: H / 2 } })

  // Draw joins
  store.parsed.joins.forEach(j => {
    const src = positions[tables[0]]
    const dst = positions[j.table]
    if (!src || !dst) return
    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(dst.x, dst.y)
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])
    const mx = (src.x + dst.x) / 2, my = (src.y + dst.y) / 2
    ctx.fillStyle = '#f97316'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(j.type, mx, my - 5)
  })

  // Draw table boxes
  tables.forEach((t) => {
    const pos = positions[t]
    if (!pos) return
    const x = pos.x, y = pos.y
    ctx.fillStyle = '#1e293b'
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x - 50, y - 30, 100, 60, 6)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#06b6d4'
    ctx.font = 'bold 13px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t, x, y - 10)
    const schema = store.tables.find(s => s.name === t)
    if (schema) {
      ctx.fillStyle = '#64748b'
      ctx.font = '10px monospace'
      ctx.fillText(schema.rowCount.toLocaleString() + ' rows', x, y + 10)
    }
  })
}

onMounted(async () => {
  await store.init()
  setTimeout(drawER, 200)
})
watch(() => store.parsed, () => setTimeout(drawER, 100), { deep: true })
</script>
