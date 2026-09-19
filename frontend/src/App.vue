<template>
  <div class="min-h-screen bg-slate-900 text-slate-200">
    <header class="border-b border-slate-700 px-6 py-4">
      <h1 class="text-2xl font-bold text-cyan-400">SQL 查询可视化与执行计划分析器</h1>
      <p class="text-sm text-slate-500 mt-1">SQL语法解析 · 执行计划树 · ER图 · 复杂度评分 · 优化建议</p>
    </header>

    <!-- 数据加载中 -->
    <div v-if="store.status === 'loading'" class="p-16 text-center text-slate-400">
      <div class="inline-block w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      <p class="mt-3 text-sm">正在从数据文件加载示例数据…</p>
    </div>

    <!-- 数据文件损坏 / 校验失败：可恢复说明，不白屏 -->
    <div v-else-if="store.status === 'error'" class="p-6 max-w-3xl mx-auto">
      <div class="bg-slate-800 rounded-lg border border-red-700 p-6">
        <h2 class="text-lg font-bold text-red-400 mb-2">⚠ 示例数据加载失败</h2>
        <p class="text-sm text-slate-300 mb-4">{{ store.loadError }}</p>
        <div v-if="store.dataIssues.length" class="space-y-2 mb-4">
          <div class="text-xs text-slate-500">需要修复的问题（来自数据文件校验）：</div>
          <div v-for="(issue, i) in store.dataIssues" :key="i"
            class="text-xs bg-red-900/30 border border-red-800 rounded p-2">
            <span class="font-bold text-red-300">{{ issue.file }}</span>
            <span class="text-slate-500"> [{{ issue.code }}]</span>
            <div class="text-slate-300 mt-0.5">{{ issue.message }}</div>
          </div>
        </div>
        <div class="text-xs text-slate-400 bg-slate-900/60 rounded p-3 leading-relaxed">
          <p class="font-bold text-slate-300 mb-1">如何恢复：</p>
          <p>1. 检查并修复 <code class="text-cyan-400">public/data/</code> 目录下被指出的 JSON 数据文件（缺失字段、表引用、模板重名或语法错误）。</p>
          <p>2. 本地开发可先运行 <code class="text-cyan-400">npm run validate:data</code> 确认校验通过。</p>
          <p>3. 修复后点击下方按钮重新加载，无需重启浏览器。</p>
        </div>
        <button @click="store.init"
          class="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-bold">重新加载示例数据</button>
      </div>
    </div>

    <div v-else class="flex flex-col lg:flex-row gap-4 p-4">
      <div class="lg:w-2/5 space-y-4">
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-400">SQL 编辑器</h3>
            <div class="flex gap-2">
              <select
                :value="store.activeTemplateId"
                @change="(e) => store.selectTemplate((e.target as HTMLSelectElement).value)"
                class="text-xs bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-300">
                <option v-for="t in store.templates" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
              <button v-if="store.sqlDirty" @click="store.resetToTemplate"
                title="放弃修改，恢复数据文件中的模板原文"
                class="text-xs bg-slate-700 hover:bg-slate-600 rounded px-2 py-1 text-slate-200">恢复模板</button>
              <button @click="store.exportActiveTemplate"
                title="导出当前示例 SQL（带头注释，可追溯来源数据文件）"
                class="text-xs bg-slate-700 hover:bg-slate-600 rounded px-2 py-1 text-slate-200">导出示例</button>
            </div>
          </div>
          <textarea v-model="store.sql" rows="12" class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono text-green-400 focus:outline-none focus:border-cyan-500 resize-none"></textarea>
          <div class="flex items-center justify-between mt-2">
            <span class="text-[11px] text-slate-600">模板来源：{{ store.templatesFile }}</span>
            <button @click="store.analyze" class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-bold">分析查询</button>
          </div>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-400">数据库 Schema</h3>
            <span class="text-[11px] text-slate-600">{{ store.schemaFile }}</span>
          </div>
          <div class="space-y-2">
            <div v-for="t in store.schemaTables" :key="t.name" @click="store.activeSchema = store.activeSchema?.name === t.name ? null : t"
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
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-400">查询解析结果</h3>
            <span class="text-[11px] text-slate-600">
              当前示例：{{ store.activeTemplate?.name }} · 结果随模板切换即时更新
            </span>
          </div>
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
import { ref, watch, nextTick, defineComponent, h } from 'vue'
import { useSQLStore } from './store/sql'

const store = useSQLStore()
const erCanvasRef = ref<HTMLCanvasElement | null>(null)

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
    const schema = store.schemaTables.find(s => s.name === t)
    if (schema) {
      ctx.fillStyle = '#64748b'
      ctx.font = '10px monospace'
      ctx.fillText(schema.rowCount.toLocaleString() + ' rows', x, y + 10)
    }
  })
}

// 数据加载完成或分析结果变化后重绘 ER 图（模板切换也会触发，保持与解析结果一致）
watch(() => [store.status, store.parsed], ([status]) => {
  if (status === 'ready') nextTick(() => setTimeout(drawER, 120))
}, { deep: true })
</script>
