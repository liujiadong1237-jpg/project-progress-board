/**
 * Project Progress Board — vanilla JS, no external deps.
 * Reads data/board.json first; optionally tries live GitHub API and falls back silently.
 */
(function () {
  "use strict";

  const SHORTFALL_THRESHOLD = 0; // balance < budget gap treated as short when gap > 0 or balance < 0

  /**
   * Map progress 0–100 to a fill color (deeper / more saturated as progress rises).
   */
  function progressColor(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    // Hue: red(0) → amber(40) → green(145)
    const hue = (p / 100) * 145;
    const sat = 55 + (p / 100) * 25;
    const light = 28 + (p / 100) * 12;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  function progressColorSoft(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const hue = (p / 100) * 145;
    return `hsl(${hue}, 60%, 42%)`;
  }

  function formatCNY(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "-" : "";
    return sign + "¥" + Math.abs(v).toLocaleString("zh-CN");
  }

  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function daysBetween(a, b) {
    return (b - a) / (86400000);
  }

  function fmtDate(d) {
    if (!d) return "—";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function isShort(item) {
    const balance = Number(item.balance) || 0;
    const budget = Number(item.budget) || 0;
    const gap = budget - balance;
    return balance < 0 || gap > SHORTFALL_THRESHOLD;
  }

  function shortfallAmount(item) {
    const balance = Number(item.balance) || 0;
    const budget = Number(item.budget) || 0;
    if (balance < 0) return Math.abs(balance) + Math.max(0, budget);
    return Math.max(0, budget - balance);
  }

  async function loadBoardJson() {
    const res = await fetch("data/board.json", { cache: "no-store" });
    if (!res.ok) throw new Error("无法加载 data/board.json (" + res.status + ")");
    return res.json();
  }

  /**
   * Optional live GitHub API enrichment. Fails silently in China / offline.
   */
  async function tryLiveGithub(board) {
    const repo =
      (board.githubMeta && board.githubMeta.defaultRepo) ||
      (board.sourceRepos && board.sourceRepos[0]);
    if (!repo) return board;

    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, 4000);

    try {
      const [issuesRes, commitsRes, branchesRes] = await Promise.all([
        fetch(
          "https://api.github.com/repos/" + repo + "/issues?state=all&per_page=30",
          { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } }
        ),
        fetch(
          "https://api.github.com/repos/" + repo + "/commits?per_page=20",
          { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } }
        ),
        fetch(
          "https://api.github.com/repos/" + repo + "/branches?per_page=30",
          { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } }
        ),
      ]);

      clearTimeout(timer);
      if (!issuesRes.ok || !commitsRes.ok || !branchesRes.ok) return board;

      const issues = await issuesRes.json();
      const commits = await commitsRes.json();
      const branches = await branchesRes.json();

      const openIssues = issues.filter(function (i) {
        return i.state === "open" && !i.pull_request;
      }).length;
      const closedIssues = issues.filter(function (i) {
        return i.state === "closed" && !i.pull_request;
      }).length;

      board = Object.assign({}, board);
      board.githubMeta = Object.assign({}, board.githubMeta || {}, {
        lastLiveFetch: new Date().toISOString(),
        liveOk: true,
        issuesTotal: openIssues + closedIssues,
        openIssues: openIssues,
        closedIssues: closedIssues,
        commitsRecent: Array.isArray(commits) ? commits.length : 0,
        branches: Array.isArray(branches)
          ? branches.map(function (b) {
              return b.name;
            })
          : [],
      });
      board._liveSource = "api.github.com";
      return board;
    } catch (e) {
      clearTimeout(timer);
      return board;
    }
  }

  function renderHeader(board) {
    const el = document.getElementById("header-meta");
    if (!el) return;
    const updated = board.updatedAt
      ? new Date(board.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
      : "—";
    const source = board._liveSource
      ? "实时 API + 本地 JSON"
      : board.source === "sync"
        ? "同步脚本"
        : "本地 board.json";
    let html =
      '<span class="badge">数据源：' +
      source +
      "</span>" +
      "<span>更新：" +
      updated +
      " (CST)</span>" +
      '<span class="badge example">余额为示例数据</span>';
    if (board.githubMeta && board.githubMeta.liveOk) {
      html +=
        '<span class="badge">Issues ' +
        (board.githubMeta.openIssues || 0) +
        " 开 / " +
        (board.githubMeta.closedIssues || 0) +
        " 关 · Commits≈" +
        (board.githubMeta.commitsRecent || 0) +
        "</span>";
    }
    el.innerHTML = html;
  }

  function renderKanban(projects) {
    const root = document.getElementById("kanban");
    if (!root) return;
    root.innerHTML = "";

    projects.forEach(function (p) {
      const col = document.createElement("div");
      col.className = "kanban-col";

      const header = document.createElement("div");
      header.className = "kanban-col-header";
      header.innerHTML =
        "<h3 title=\"" +
        escapeHtml(p.name) +
        "\">" +
        escapeHtml(p.name) +
        "</h3>" +
        '<div class="pct">进度 ' +
        (p.progress || 0) +
        "%</div>";

      const body = document.createElement("div");
      body.className = "kanban-col-body";

      const card = document.createElement("div");
      card.className = "card";
      card.style.background = progressColor(p.progress);
      card.style.boxShadow =
        "0 4px 16px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08)";

      // Visual fill bar at bottom reflecting progress
      const fillBar = document.createElement("div");
      fillBar.style.cssText =
        "position:absolute;left:0;bottom:0;height:4px;width:" +
        Math.max(0, Math.min(100, p.progress || 0)) +
        "%;background:rgba(255,255,255,0.45);";

      let gh = "";
      if (p.github) {
        const parts = [];
        if (p.github.openIssues != null)
          parts.push("开Issue " + p.github.openIssues);
        if (p.github.commits) parts.push("提交 " + p.github.commits);
        if (p.github.branches && p.github.branches.length)
          parts.push("分支 " + p.github.branches.length);
        if (parts.length) gh = '<div class="gh-stats">' + parts.join(" · ") + "</div>";
      }

      card.innerHTML =
        '<div class="stage">' +
        escapeHtml(p.stage || "未设阶段") +
        "</div>" +
        '<div class="deadline">截止：' +
        escapeHtml(p.deadline || "未定") +
        "</div>" +
        '<div class="progress-label">' +
        (p.progress || 0) +
        "% 完成</div>" +
        (p.note ? '<div class="note">' + escapeHtml(p.note) + "</div>" : "") +
        gh;
      card.appendChild(fillBar);
      body.appendChild(card);
      col.appendChild(header);
      col.appendChild(body);
      root.appendChild(col);
    });
  }

  function renderGantt(projects) {
    const root = document.getElementById("gantt");
    if (!root) return;

    const starts = [];
    const ends = [];
    projects.forEach(function (p) {
      const s = parseDate(p.startDate) || parseDate("2026-01-01");
      const e = parseDate(p.deadline) || parseDate("2026-12-31");
      starts.push(s);
      ends.push(e);
    });
    const rangeStart = new Date(Math.min.apply(null, starts.map(Number)));
    const rangeEnd = new Date(Math.max.apply(null, ends.map(Number)));
    const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));
    const today = new Date();
    const todayPct = Math.max(
      0,
      Math.min(100, (daysBetween(rangeStart, today) / totalDays) * 100)
    );

    let rows = "";
    projects.forEach(function (p) {
      const s = parseDate(p.startDate) || rangeStart;
      const e = parseDate(p.deadline) || rangeEnd;
      const left = Math.max(0, (daysBetween(rangeStart, s) / totalDays) * 100);
      const width = Math.max(
        1.5,
        (daysBetween(s, e) / totalDays) * 100
      );
      const color = progressColorSoft(p.progress);
      rows +=
        "<tr>" +
        '<td class="gantt-name" title="' +
        escapeHtml(p.name) +
        '">' +
        escapeHtml(p.name) +
        "</td>" +
        "<td>" +
        escapeHtml(p.stage || "—") +
        "</td>" +
        "<td>" +
        escapeHtml(p.deadline || "—") +
        "</td>" +
        "<td>" +
        '<div class="gantt-track">' +
        '<div class="gantt-today" style="left:' +
        todayPct +
        '%" title="今天"></div>' +
        '<div class="gantt-bar" style="left:' +
        left +
        "%;width:" +
        width +
        "%;background:" +
        color +
        '">' +
        (p.progress || 0) +
        "%</div>" +
        "</div>" +
        "</td>" +
        "</tr>";
    });

    root.innerHTML =
      '<div class="gantt-wrap">' +
      '<table class="gantt-table">' +
      "<thead><tr><th>项目</th><th>阶段</th><th>截止</th><th>时间线</th></tr></thead>" +
      "<tbody>" +
      rows +
      "</tbody></table>" +
      '<div class="gantt-axis"><span>' +
      fmtDate(rangeStart) +
      "</span><span>今天 ≈ " +
      fmtDate(today) +
      "</span><span>" +
      fmtDate(rangeEnd) +
      "</span></div>" +
      "</div>";
  }

  function renderMoney(money) {
    const list = document.getElementById("money-list");
    const totalEl = document.getElementById("money-total");
    const shortEl = document.getElementById("shortfall-list");
    if (!list || !totalEl) return;

    let totalBalance = 0;
    let totalBudget = 0;
    const shorts = [];

    list.innerHTML = "";
    (money || []).forEach(function (item) {
      const balance = Number(item.balance) || 0;
      const budget = Number(item.budget) || 0;
      totalBalance += balance;
      totalBudget += budget;
      const short = isShort(item);
      if (short) shorts.push(item);

      const ratio =
        budget > 0
          ? Math.min(100, Math.max(0, (balance / budget) * 100))
          : balance >= 0
            ? 100
            : 0;

      const div = document.createElement("div");
      div.className = "money-item" + (short ? " short" : "");
      div.innerHTML =
        '<div class="row">' +
        '<span class="name">' +
        escapeHtml(item.name) +
        "</span>" +
        '<span class="bal ' +
        (balance < 0 ? "neg" : "ok") +
        '">' +
        formatCNY(balance) +
        "</span>" +
        "</div>" +
        '<div class="money-bar"><div class="money-bar-fill ' +
        (short ? "short" : "ok") +
        '" style="width:' +
        ratio +
        '%"></div></div>' +
        '<div class="meta">预算 ' +
        formatCNY(budget) +
        (short
          ? " · <span style=\"color:var(--danger)\">缺口 " +
            formatCNY(shortfallAmount(item)) +
            "</span>"
          : " · 余量充足") +
        "</div>" +
        (item.note
          ? '<div class="meta">' + escapeHtml(item.note) + "</div>"
          : "");
      list.appendChild(div);
    });

    totalEl.innerHTML =
      '<div class="label">合计余额（示例）</div>' +
      '<div class="amount">' +
      formatCNY(totalBalance) +
      "</div>" +
      '<div class="sub">总预算 ' +
      formatCNY(totalBudget) +
      " · 总缺口 " +
      formatCNY(Math.max(0, totalBudget - totalBalance)) +
      "</div>";

    if (shortEl) {
      if (shorts.length === 0) {
        shortEl.innerHTML =
          '<h3 style="color:var(--success)">暂无短缺项目</h3>';
      } else {
        shortEl.innerHTML =
          "<h3>短缺一览（" +
          shorts.length +
          "）</h3><ul>" +
          shorts
            .map(function (s) {
              return (
                "<li>" +
                escapeHtml(s.name) +
                " — 缺口 " +
                formatCNY(shortfallAmount(s)) +
                "</li>"
              );
            })
            .join("") +
          "</ul>";
      }
    }
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderAll(board) {
    renderHeader(board);
    renderKanban(board.projects || []);
    renderGantt(board.projects || []);
    renderMoney(board.money || []);
  }

  async function main() {
    const status = document.getElementById("status");
    try {
      let board = await loadBoardJson();
      renderAll(board);
      if (status) status.style.display = "none";

      // Silent live enrich (China-friendly: fails quietly)
      const enriched = await tryLiveGithub(board);
      if (enriched !== board && enriched._liveSource) {
        renderAll(enriched);
      }
    } catch (err) {
      if (status) {
        status.textContent =
          "加载失败：" + (err && err.message ? err.message : String(err));
        status.style.display = "block";
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
