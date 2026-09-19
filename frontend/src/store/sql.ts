import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { parseSQL, buildPlan } from '../core/analyzer'
import { loadExamples } from '../core/loadExamples'
import type {
  LoadedExamples,
  ParsedQuery,
  QueryPlan,
  SQLTable,
  SQLTemplate,
  DataProvenance,
  ValidationIssue,
} from '../core/types'

export type {
  SQLTable,
  SQLColumn,
  SQLTemplate,
  ParsedQuery,
  QueryPlan,
  DataProvenance,
  ValidationIssue,
} from '../core/types'

/**
 * 示例库 store。
 * 数据来源唯一入口是 core/loadExamples（按统一规则读取 data/*.json），
 * store 本身不内置任何示例 SQL 或表结构。
 */
export const useSQLStore = defineStore('sql', () => {
  /** 加载生命周期：loading 期间页面展示加载态，避免白屏 */
  const loadState = ref<'loading' | 'ready' | 'fatal'>('loading')
  const fatalMessage = ref('')
  const fatalIssues = ref<ValidationIssue[]>([])

  const tables = ref<SQLTable[]>([])
  const templates = ref<SQLTemplate[]>([])
  /** 数据来源（可追溯到具体数据文件） */
  const schemaSource = ref<DataProvenance | null>(null)
  const templatesSource = ref<DataProvenance | null>(null)
  const degraded = ref(false)
  const dataIssues = ref<ValidationIssue[]>([])

  const sql = ref('')
  const parsed = ref<ParsedQuery | null>(null)
  const plan = ref<QueryPlan | null>(null)
  const activeSchema = ref<SQLTable | null>(null)
  /** 当前选中的模板下标；-1 表示已手动改动、与模板脱钩 */
  const selectedTemplateIndex = ref(-1)
  /** 编辑器内容是否已被手动修改（与所选模板不一致） */
  const dirty = computed(() => {
    const tpl = templates.value[selectedTemplateIndex.value]
    return !!tpl && sql.value !== tpl.sql
  })

  function analyze() {
    parsed.value = parseSQL(sql.value, tables.value)
    plan.value = buildPlan(parsed.value, tables.value)
  }

  /** 切换模板：载入模板 SQL 并立即重新分析，保证展示与所选模板一致 */
  function selectTemplate(index: number) {
    const tpl = templates.value[index]
    if (!tpl) return
    selectedTemplateIndex.value = index
    sql.value = tpl.sql
    analyze()
  }

  /** 手动编辑后取消与模板的绑定 */
  function markManualEdit() {
    selectedTemplateIndex.value = -1
  }

  async function init() {
    loadState.value = 'loading'
    try {
      const data: LoadedExamples = await loadExamples()
      tables.value = data.schema
      templates.value = data.templates
      schemaSource.value = data.schemaSource
      templatesSource.value = data.templatesSource
      degraded.value = data.degraded
      dataIssues.value = data.issues
      // 初始默认选中第一个模板并完成首次分析
      selectTemplate(0)
      loadState.value = 'ready'
    } catch (err) {
      loadState.value = 'fatal'
      fatalMessage.value = err instanceof Error ? err.message : String(err)
      fatalIssues.value = (err as { issues?: ValidationIssue[] })?.issues || []
    }
  }

  const complexityLabel = computed(() => {
    const c = parsed.value?.complexity || 0
    if (c <= 2) return { label: '简单', color: 'text-green-400' }
    if (c <= 5) return { label: '中等', color: 'text-yellow-400' }
    if (c <= 8) return { label: '复杂', color: 'text-orange-400' }
    return { label: '非常复杂', color: 'text-red-400' }
  })

  /** 当前编辑器 SQL 对应的模板（用于导出溯源），手动编辑时为 null */
  const activeTemplate = computed(() => templates.value[selectedTemplateIndex.value] || null)

  return {
    // 加载状态
    loadState, fatalMessage, fatalIssues,
    // 示例数据与来源
    tables, templates, schemaSource, templatesSource, degraded, dataIssues,
    // 查询状态
    sql, parsed, plan, activeSchema,
    selectedTemplateIndex, dirty, activeTemplate, complexityLabel,
    // 动作
    init, analyze, selectTemplate, markManualEdit,
  }
})
