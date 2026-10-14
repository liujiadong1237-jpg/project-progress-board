# 项目进度看板 · project-progress-board

可视化**闭环看板**：列 = 闭环；卡 = **投入 / 进度 / 下一步**；右侧为金库事实资金侧栏。  
纯静态 GitHub Pages，零外部 CDN / 无 Google Fonts，适合中国大陆直接打开。

## 链接

| 项目 | URL |
|------|-----|
| 仓库 | https://github.com/liujiadong1237-jpg/project-progress-board |
| GitHub Pages | https://liujiadong1237-jpg.github.io/project-progress-board/ |

## 真实数据政策（重要）

- **禁止**示例数据 / EXAMPLE / demo / 虚构余额（含旧 `-500`）。
- 资金数字**只**来自主库可核验事实；未知写 `null` + `status: "待核验"`，UI 显示「待核验 / 暂无」，**不**用 ¥0 假装真实。
- 当前手头现金：`money.cashOnHand.amount = 2100`（2026-10-07 口述）；负债本金来自 **D-门店业务/极简收入台账**（**现行台账**，非归档）。
- 分闭环余额几乎全部待核验；短缺只在余额与预算均为数字（或余额 &lt; 0）时计算。

## 分类（八大总项目不变）

| 侧 | 含义 | 看板列 |
|----|------|--------|
| **06 健康与学习** | 个人学习 / 能力训练 | `health-learn`（含口播软件、Gape House 英语） |
| **03 经营与发展** | 店务、软件、商业验证 | `store-ops` / `biz-validate` / `cashier` / `ai-matchstick` / 修鞋获客 |
| **07 家庭** | 家庭事务 | `family` |

- 英语/口播/AI **能力训练** → 06；**能否变现** → 03。卡之间只互引，不双写状态。
- 03 状态标签仅允许：`当前执行` \| `已有成果待验收` \| `商业候选` \| `暂停`。
- **D 极简收入台账**、**E 现行手册** = 现行源记录；新事实继续写入既有入口，不新造工作台卡。

## 排程负责人

- **唯一**排程 + 主库入库：`Codex`（Windows/本机）。
- Grok/도윤 = 秘书（想法与调研），**不设第二套日历**。

## 卡片三件套（必填）

编辑 [`data/board.json`](data/board.json) 中每张卡：

```json
{
  "id": "koubo-software",
  "name": "口播软件学习",
  "invested": null,
  "investedNote": "暂无分项投入记录",
  "progress": 5,
  "stage": "学习启动",
  "nextAction": "今天听口播软件第1课：讲解/停顿/讲述位置，并写3条笔记",
  "deadline": "2026-12-31"
}
```

- `invested` 为 `null` → UI 显示「暂无」。
- `nextAction` 必须是今天/本周可执行的具体动作。

## 同步

```bash
node scripts/sync-from-github.mjs
```

脚本只刷新 GitHub meta（issues/commits/branches），**保留** money、进度、阶段、截止、投入、下一步与排程字段。

## 目录

```
├── index.html
├── assets/style.css
├── assets/app.js
├── data/board.json      # 主数据（Pages 直接提供）
├── config.json
└── scripts/sync-from-github.mjs
```

## 技术约束

- 纯 HTML / CSS / 原生 JS，无构建步骤。
- 不使用易被墙的 CDN / Google Fonts。
- 部署：GitHub Pages（`main` 根目录）。

## 许可证

MIT。资金与进度以主库事实为准，本页不是第二账本。
