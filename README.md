# SQL 查询可视化与执行计划分析器
Monaco Editor SQL编辑 · 语法树Canvas渲染 · ER图 · 查询复杂度评分

## 示例数据文件（与业务代码解耦）

示例库（表结构）与 SQL 模板不再硬编码在业务代码中，而是独立的数据文件，业务代码只按统一的读取规则加载：

| 文件 | 内容 |
| --- | --- |
| `public/data/schema.json` | 示例表结构（表、列、主键/外键、行数） |
| `public/data/templates.json` | SQL 模板（名称、SQL、说明） |
| `src/data/builtin/*.json` | 随包发布的内置兜底副本（与外部文件结构相同），仅供运行时降级，不要在业务代码中引用 |

改一条示例只需要改 `public/data/*.json`，无需动逻辑代码。文件结构见 `src/core/types.ts` 中的 `SchemaFile` / `TemplateFile`。

### 读取规则（统一入口：`src/core/loadExamples.ts`）

1. 运行时固定从 `data/schema.json`、`data/templates.json` 读取；
2. 文件缺失 / JSON 损坏 / 字段缺失非法 / 模板引用的表不存在 / 模板重名时，自动回退到内置副本，页面照常可用并给出恢复说明（不白屏）；
3. “模板 ↔ schema”不自洽时整组示例库一起回退，保证展示的示例集始终自洽；
4. 每份数据都带 `sourceFile` 与 `origin`（external/builtin）来源信息，页面与导出内容均可追溯到对应数据文件。

### 校验（本地开发与构建）

校验规则只有一份实现 `src/core/validator.mjs`，被命令行、Vite 插件、运行时加载器共用：

```bash
npm run validate:examples          # 校验 public/data（本地手动执行）
npm run validate:examples:strict   # 额外校验内置副本，任何 error 以非零码退出
npm run dev                        # 启动开发服务器：终端明确报出数据问题，但不阻断（页面走降级并提示恢复）
npm run build                      # 构建前强校验，数据非法直接构建失败
```

校验覆盖：必填字段缺失/类型错误、表名与列名重名、外键引用不存在的表/列、SQL 模板重名、模板引用的表不存在、JSON 损坏。

### 数据损坏时如何恢复

- 页面会出现顶部横幅（已降级）或全屏说明（外部文件与内置副本同时不可用）；
- 本地开发可直接点“从内置副本恢复并重试”（dev 接口 `POST /__dev/reset-examples` 会用 `src/data/builtin` 覆盖 `public/data`）；
- 也可手动用 `src/data/builtin/schema.json`、`src/data/builtin/templates.json` 覆盖 `public/data/` 下同名文件后刷新。

## 开发

```bash
npm install
npm run dev      # 本地开发
npm run build    # 类型检查 + 数据强校验 + 生产构建
npm run preview  # 预览构建产物
```
