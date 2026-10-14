# 项目进度看板 · project-progress-board

可视化项目进度看板：**看板（Kanban）+ 甘特（Gantt）+ 右侧资金余额面板**。  
纯静态站点，零外部 CDN / 无 Google Fonts，适合中国大陆浏览器直接打开。

## 链接

| 项目 | URL |
|------|-----|
| 仓库 | https://github.com/liujiadong1237-jpg/project-progress-board |
| GitHub Pages | https://liujiadong1237-jpg.github.io/project-progress-board/ |

若 Pages 打开较慢，可克隆仓库后用浏览器直接打开本地 `index.html`（数据来自同目录下的 `data/board.json`）。

## 功能一览

1. **看板**：每一列 = 一个项目；卡片显示**阶段名 + 截止日期**；卡片底色深浅反映进度 0–100%。
2. **甘特时间线**：按开始日 / 截止日期绘制条形进度。
3. **资金余额侧栏**：各项目余额 / 预算条、合计、短缺一览（余额 &lt; 0 或 预算 − 余额 &gt; 0）。**金额均为示例数据**，UI 中标注「示例数据」。
4. **数据优先读本地 JSON**：页面加载 `data/board.json`；可选尝试 `api.github.com`，失败则静默回退（大陆环境常见）。

## 如何填写初始项目 / 资金数据

编辑 [`data/board.json`](data/board.json)：

### 项目（`projects`）

```json
{
  "id": "xiuxiu",
  "name": "修修会修",
  "progress": 30,
  "stage": "内容获客",
  "deadline": "2026-11-15",
  "startDate": "2026-09-01",
  "note": "新账号"
}
```

- `progress`：0–100，控制卡片颜色深度与甘特条。
- `stage` / `deadline`：卡片主信息。
- `startDate`：甘特条左端。

### 资金（`money`）

```json
{
  "projectId": "xiuxiu",
  "name": "修修会修",
  "balance": 3200,
  "budget": 8000,
  "note": "示例数据 — 投放预算余量"
}
```

- **短缺判定**：`balance < 0`，或 `budget - balance > 0`（侧栏会标红并汇总缺口）。
- GitHub **没有**资金 API，金额只会来自本 JSON（同步脚本不会覆盖 `money`）。

### 项目映射（`config.json`）

`config.json` 中的 `projects[].githubLabels` / `branchHints` 用于同步脚本把 Issue / 分支归到对应项目。

## 同步如何工作

大陆浏览器往往无法直连 `api.github.com`，因此采用：

```
本机 / CI 运行同步脚本  →  写入 data/board.json  →  提交推送
        ↓
GitHub Pages 提供静态 JSON  →  浏览器只读 Pages，无需调 API
```

### 本地手动同步

```bash
# 需要已登录 gh，或设置 GITHUB_TOKEN
node scripts/sync-from-github.mjs
```

脚本会：

1. 读取 `config.json` 中的 `sourceRepos`（默认 `liujiadong1237-jpg/personal-evolution-system`）。
2. 拉取 issues / commits / branches，按标签与分支名启发式映射到项目。
3. **保留**已有的 `progress`、`stage`、`deadline`、`money`，只更新 GitHub 相关字段与 `updatedAt`。
4. 写回 `data/board.json`。

### GitHub Actions 自动同步

工作流模板：[scripts/sync-board.workflow.yml](scripts/sync-board.workflow.yml)

当前 `gh` OAuth 令牌缺少 `workflow` 权限，无法直接推送 `.github/workflows/`。启用方式（任选其一）：

1. **网页**：仓库 → Actions → 新建 workflow → 粘贴 `scripts/sync-board.workflow.yml` 内容，保存为 `sync-board.yml`
2. **CLI**（需先 `gh auth refresh -s workflow`）：
   ```bash
   mkdir -p .github/workflows
   cp scripts/sync-board.workflow.yml .github/workflows/sync-board.yml
   git add .github/workflows/sync-board.yml && git commit -m "ci: add sync workflow" && git push
   ```

启用后：

- **定时**：每天 UTC 02:00（约北京时间 10:00）
- **手动**：Actions 页 →「Sync board.json from GitHub」→ Run workflow
- 使用 `GITHUB_TOKEN` 拉取元数据并 **commit** 更新后的 `board.json`，大陆用户刷新 Pages 即可拿到新数据。

## 目录结构

```
├── index.html                 # 看板页面
├── assets/style.css
├── assets/app.js
├── data/board.json            # 主数据（Pages 直接提供）
├── config.json                # 源仓库与项目映射
├── scripts/sync-from-github.mjs
└── .github/workflows/sync-board.yml
```

## 技术约束

- 纯 HTML / CSS / 原生 JS，无构建步骤。
- 不使用 unpkg / jsDelivr / Google Fonts 等易被墙资源。
- 部署：GitHub Pages（`main` 分支根目录 `/`）。

## 许可证

MIT（示例资金数据仅供演示，请勿当作真实账本。）
