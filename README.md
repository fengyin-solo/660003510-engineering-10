# SQL 查询可视化与执行计划分析器
Monaco Editor SQL编辑 · 语法树Canvas渲染 · ER图 · 查询复杂度评分

## 示例数据（数据文件驱动）

示例表结构与 SQL 模板不再硬编码在业务代码中，统一存放在 `frontend/public/data/`，
业务代码只按清单规则加载（见 `frontend/src/data/loader.ts`）：

| 文件 | 内容 |
| --- | --- |
| `frontend/public/data/manifest.json` | 数据文件清单，声明要加载哪些数据文件（新增数据文件需在此登记） |
| `frontend/public/data/schema.json` | 示例数据库表结构（表名、列、类型、PK/FK、行数） |
| `frontend/public/data/templates.json` | 内置 SQL 示例模板（id、name、sql） |

数据来源会随数据一起标注：Schema 面板、模板面板会展示来源文件；
「导出示例」生成的 `.sql` 文件头注释包含模板 id 与来源数据文件，可追溯。

### 校验规则

`frontend/src/data/validator.js` 是同构校验核心（浏览器与 Node 共用，无第三方依赖），启动/构建时会检查：

- **字段缺失/类型错误**：表、列、模板的必填字段（name、type、sql 等）
- **引用的表不存在**：schema 中 FK 引用的表/列不存在；模板 SQL 中 FROM/JOIN 的表在 schema 中不存在
- **重名**：表重名、列重名、模板 id 重复、模板重名
- **数据文件损坏**：manifest 或任一 JSON 文件无法解析、清单声明的文件读取失败

校验时机：

- `npm run dev`（在 `frontend/` 下执行，下同）：`predev` 先跑 CLI 校验；Vite 插件在开发服务器启动时再次校验，
  且监听 `frontend/public/data/`，保存数据文件即热校验（错误同时推送到浏览器叠加层）
- `npm run build`：`prebuild` 先跑 CLI 校验，Vite 构建钩子里再校验，任一错误中止构建
- `npm run validate:data`：只做数据校验，可用于 CI
- 浏览器运行时：加载数据时用同一套规则校验；数据文件损坏/非法时页面显示
  可恢复的错误面板（列出问题文件与修复指引，可一键重新加载），不会白屏

### 新增或修改示例

1. 编辑 `frontend/public/data/` 下的 JSON（新增文件要在 `manifest.json` 登记）
2. 运行 `npm run validate:data` 确认通过
3. 无需改动任何业务代码
