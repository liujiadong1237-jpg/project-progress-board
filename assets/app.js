/**
 * Project Progress Board — closed-loop Kanban.
 * Columns = loops; cards show 投入 / 进度 / 下一步.
 * Money from vault facts only; null → 待核验 / 暂无.
 * No external CDN.
 */
(function () {
  "use strict";

  function progressColor(pct) {
    if (pct == null || pct === "") return "hsl(210, 18%, 32%)";
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    var hue = (p / 100) * 145;
    var sat = 55 + (p / 100) * 25;
    var light = 28 + (p / 100) * 12;
    return "hsl(" + hue + ", " + sat + "%, " + light + "%)";
  }

  function progressColorSoft(pct) {
    if (pct == null || pct === "") return "hsl(210, 25%, 40%)";
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    var hue = (p / 100) * 145;
    return "hsl(" + hue + ", 60%, 42%)";
  }

  function formatCNY(n) {
    if (n == null || n === "") return "待核验";
    var v = Number(n);
    if (isNaN(v)) return "待核验";
    var sign = v < 0 ? "-" : "";
    return sign + "¥" + Math.abs(v).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }

  function formatInvested(card) {
    if (card.invested == null || card.invested === "") {
      return "暂无";
    }
    return formatCNY(card.invested);
  }

  function checklistItems(card) {
    var raw =
      card.checklist ||
      card.subtasks ||
      card.tasks ||
      card.checks ||
      null;
    return Array.isArray(raw) ? raw : null;
  }

  function isChecklistDone(item) {
    if (item == null) return false;
    if (typeof item === "boolean") return item;
    if (typeof item === "string") {
      var s = item.trim().toLowerCase();
      return s.indexOf("[x]") === 0 || s === "done" || s === "完成" || s === "已完成";
    }
    if (typeof item !== "object") return false;
    if (item.done === true || item.completed === true || item.checked === true) return true;
    var st = String(item.status || item.state || "").toLowerCase();
    return (
      st === "done" ||
      st === "completed" ||
      st === "closed" ||
      st === "完成" ||
      st === "已完成"
    );
  }

  /** Auto progress: checklist first, else elapsed/total days; else null. */
  function computeAutoProgress(card) {
    var items = checklistItems(card);
    if (items && items.length) {
      var done = 0;
      items.forEach(function (it) {
        if (isChecklistDone(it)) done += 1;
      });
      return {
        pct: Math.round((done / items.length) * 100),
        source: "checklist",
        detail: done + "/" + items.length,
      };
    }

    // Million-plan / manual cards: never treat calendar span as completion.
    if (
      card.autoScheduleProgress === false ||
      card.progressMode === "manual" ||
      card.id === "million-baseline"
    ) {
      return { pct: null, source: null, detail: null };
    }

    var start = parseDate(card.startDate);
    var end = parseDate(card.deadline);
    if (start && end && end > start) {
      var today = new Date();
      var elapsed = daysBetween(start, today);
      var total = daysBetween(start, end);
      var ratio = elapsed / total;
      if (ratio < 0) ratio = 0;
      if (ratio > 1) ratio = 1;
      return {
        pct: Math.round(ratio * 100),
        source: "schedule",
        detail: null,
      };
    }

    return { pct: null, source: null, detail: null };
  }

  function effectiveProgress(card) {
    var auto = computeAutoProgress(card);
    if (auto.pct != null) return auto;
    if (card.progress != null && card.progress !== "") {
      return { pct: Number(card.progress), source: "manual", detail: null };
    }
    return { pct: null, source: null, detail: null };
  }

  function formatProgress(card) {
    var auto = computeAutoProgress(card);
    if (auto.pct != null) {
      if (auto.source === "checklist") {
        return auto.pct + "%（检查项 " + auto.detail + "）";
      }
      return auto.pct + "%（按日程）";
    }
    if (card.status === "待核验" && (card.progress == null || card.progress === "")) {
      return "待核验";
    }
    if (card.progress == null || card.progress === "") {
      if (card.legacyMilestonePct != null) {
        return "基线待核（历史里程碑 " + card.legacyMilestonePct + "%）";
      }
      return "待核验";
    }
    return card.progress + "%（手填遗留）";
  }

  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function daysBetween(a, b) {
    return (b - a) / 86400000;
  }

  function fmtDate(d) {
    if (!d) return "—";
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toCST(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    } catch (e) {
      return String(iso);
    }
  }

  function flattenCards(board) {
    var out = [];
    (board.columns || []).forEach(function (col) {
      (col.cards || []).forEach(function (card) {
        out.push(Object.assign({}, card, { columnId: col.id, columnName: col.name }));
      });
    });
    // legacy flat projects
    (board.projects || []).forEach(function (p) {
      out.push(p);
    });
    return out;
  }

  async function loadBoardJson() {
    var res = await fetch("data/board.json", { cache: "no-store" });
    if (!res.ok) throw new Error("无法加载 data/board.json (" + res.status + ")");
    return res.json();
  }

  async function tryLiveGithub(board) {
    var repo =
      (board.githubMeta && board.githubMeta.defaultRepo) ||
      (board.sourceRepos && board.sourceRepos[0]);
    if (!repo) return board;

    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, 4000);

    try {
      var issuesRes = await fetch(
        "https://api.github.com/repos/" + repo + "/issues?state=all&per_page=10",
        { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } }
      );
      clearTimeout(timer);
      if (!issuesRes.ok) return board;
      board = Object.assign({}, board);
      board.githubMeta = Object.assign({}, board.githubMeta || {}, {
        lastLiveFetch: new Date().toISOString(),
        liveOk: true,
      });
      board._liveSource = "api.github.com";
      return board;
    } catch (e) {
      clearTimeout(timer);
      return board;
    }
  }

  function renderHeader(board) {
    var el = document.getElementById("header-meta");
    if (!el) return;
    var asOf = board.asOf || (board.money && board.money.asOf) || "—";
    var sync = board.githubMeta && board.githubMeta.lastSync
      ? toCST(board.githubMeta.lastSync)
      : toCST(board.updatedAt);
    var repos = (board.sourceRepos || []).join(" · ") || "—";
    var sched = board.scheduleOwner;
    var schedBadge = "";
    if (sched && sched.owner) {
      schedBadge =
        '<span class="badge ok">排程/入库：' +
        escapeHtml(sched.owner) +
        (sched.platform ? "（" + escapeHtml(sched.platform) + "）" : "") +
        "</span>";
      if (sched.secretary && sched.secretary.who) {
        schedBadge +=
          '<span class="badge">秘书：' +
          escapeHtml(sched.secretary.who) +
          "（想法/调研，无日历）</span>";
      }
    }
    var html =
      '<span class="badge">数据截止 ' +
      escapeHtml(asOf) +
      "</span>" +
      "<span>GitHub 同步：" +
      escapeHtml(sync) +
      " CST</span>" +
      '<span class="badge">源：' +
      escapeHtml(repos) +
      "</span>" +
      schedBadge +
      '<span class="badge ok">金库事实 · 无示例数据</span>';
    el.innerHTML = html;
  }

  function renderCard(card) {
    var eff = effectiveProgress(card);
    var pct = eff.pct;
    var cardEl = document.createElement("div");
    cardEl.className = "card" + (card.status === "待核验" ? " pending" : "");
    cardEl.style.background = progressColor(pct);

    var fill = document.createElement("div");
    fill.className = "card-fill";
    fill.style.width =
      pct == null || pct === "" ? "0%" : Math.max(0, Math.min(100, Number(pct))) + "%";

    var tag =
      card.tag
        ? '<span class="card-tag">' + escapeHtml(card.tag) + "</span>"
        : card.status === "待核验"
          ? '<span class="card-tag pending">待核验</span>'
          : "";

    var legacy =
      card.legacyMilestonePct != null
        ? '<div class="meta-line">历史里程碑 ' +
          card.legacyMilestonePct +
          "%（非净资产完成率）</div>"
        : "";

    var link =
      card.link
        ? '<div class="meta-line"><a class="card-link" href="' +
          escapeHtml(card.link) +
          '" target="_blank" rel="noopener">相关仓库</a></div>'
        : "";

    var related =
      card.relatedCardIds && card.relatedCardIds.length
        ? '<div class="meta-line">互引：' +
          escapeHtml(card.relatedCardIds.join(" · ")) +
          "</div>"
        : "";

    cardEl.innerHTML =
      '<div class="card-title">' +
      escapeHtml(card.name || card.id) +
      tag +
      "</div>" +
      '<div class="stage">' +
      escapeHtml(card.stage || "未设阶段") +
      "</div>" +
      '<div class="triple">' +
      '<div class="triple-row"><span class="k">投入</span><span class="v">' +
      escapeHtml(formatInvested(card)) +
      (card.investedNote
        ? ' <span class="hint">(' + escapeHtml(card.investedNote) + ")</span>"
        : "") +
      "</span></div>" +
      '<div class="triple-row"><span class="k">进度</span><span class="v">' +
      escapeHtml(formatProgress(card)) +
      (eff.pct != null ? " · " + escapeHtml(card.stage || "") : "") +
      "</span></div>" +
      '<div class="triple-row next"><span class="k">下一步</span><span class="v">' +
      escapeHtml(card.nextAction || "（待补具体动作）") +
      "</span></div>" +
      "</div>" +
      '<div class="deadline">截止：' +
      escapeHtml(card.deadline || "未定") +
      "</div>" +
      legacy +
      (card.note ? '<div class="note">' + escapeHtml(card.note) + "</div>" : "") +
      related +
      link;

    cardEl.appendChild(fill);
    return cardEl;
  }

  function renderKanban(board) {
    var root = document.getElementById("kanban");
    if (!root) return;
    root.innerHTML = "";
    var columns = board.columns || [];
    if (!columns.length && board.projects) {
      // fallback legacy
      columns = board.projects.map(function (p) {
        return { id: p.id, name: p.name, cards: [p] };
      });
    }

    columns.forEach(function (col) {
      var colEl = document.createElement("div");
      colEl.className = "kanban-col";
      var cards = col.cards || [];
      var known = cards
        .map(function (c) {
          return effectiveProgress(c);
        })
        .filter(function (e) {
          return e.pct != null;
        });
      var avg =
        known.length === 0
          ? null
          : Math.round(
              known.reduce(function (s, e) {
                return s + Number(e.pct);
              }, 0) / known.length
            );

      var header = document.createElement("div");
      header.className = "kanban-col-header";
      header.innerHTML =
        "<h3 title=\"" +
        escapeHtml(col.name) +
        "\">" +
        escapeHtml(col.name) +
        "</h3>" +
        '<div class="pct">' +
        cards.length +
        " 张卡 · " +
        (avg == null ? "进度待核" : "均 " + avg + "%") +
        "</div>";

      var body = document.createElement("div");
      body.className = "kanban-col-body";
      cards.forEach(function (card) {
        body.appendChild(renderCard(card));
      });

      colEl.appendChild(header);
      colEl.appendChild(body);
      root.appendChild(colEl);
    });
  }

  function renderGantt(board) {
    var root = document.getElementById("gantt");
    if (!root) return;
    var cards = flattenCards(board).filter(function (c) {
      return parseDate(c.startDate) || parseDate(c.deadline);
    });
    if (!cards.length) {
      root.innerHTML =
        '<div class="gantt-wrap"><p class="empty">暂无带日期的卡片可绘制甘特。</p></div>';
      return;
    }

    var starts = [];
    var ends = [];
    cards.forEach(function (p) {
      var s = parseDate(p.startDate);
      var e = parseDate(p.deadline);
      if (s) starts.push(s);
      if (e) ends.push(e);
      if (!s && e) starts.push(e);
      if (!e && s) ends.push(s);
    });
    var rangeStart = new Date(Math.min.apply(null, starts.map(Number)));
    var rangeEnd = new Date(Math.max.apply(null, ends.map(Number)));
    var totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));
    var today = new Date();
    var todayPct = Math.max(
      0,
      Math.min(100, (daysBetween(rangeStart, today) / totalDays) * 100)
    );

    var rows = "";
    cards.forEach(function (p) {
      var s = parseDate(p.startDate) || rangeStart;
      var e = parseDate(p.deadline) || rangeEnd;
      var left = Math.max(0, (daysBetween(rangeStart, s) / totalDays) * 100);
      var width = Math.max(1.5, (daysBetween(s, e) / totalDays) * 100);
      var gEff = effectiveProgress(p);
      var color = progressColorSoft(gEff.pct);
      var label =
        gEff.pct == null
          ? p.autoScheduleProgress === false ||
            p.progressMode === "manual" ||
            p.status === "待核验" ||
            p.id === "million-baseline"
            ? "待核"
            : "—"
          : gEff.pct + "%";
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
        label +
        "</div></div></td></tr>";
    });

    root.innerHTML =
      '<div class="gantt-wrap">' +
      '<table class="gantt-table">' +
      "<thead><tr><th>卡片</th><th>阶段</th><th>截止</th><th>时间线</th></tr></thead>" +
      "<tbody>" +
      rows +
      "</tbody></table>" +
      '<div class="gantt-axis"><span>' +
      fmtDate(rangeStart) +
      "</span><span>今天 ≈ " +
      fmtDate(today) +
      "</span><span>" +
      fmtDate(rangeEnd) +
      "</span></div></div>";
  }

  function computableShortfall(loop) {
    if (loop.balance != null && Number(loop.balance) < 0) {
      return Math.abs(Number(loop.balance));
    }
    if (
      loop.balance != null &&
      loop.budget != null &&
      !isNaN(Number(loop.balance)) &&
      !isNaN(Number(loop.budget))
    ) {
      var gap = Number(loop.budget) - Number(loop.balance);
      return gap > 0 ? gap : 0;
    }
    return null;
  }

  function renderMoney(money) {
    if (!money || Array.isArray(money)) {
      // legacy array — should not appear after rebuild
      var list = document.getElementById("money-list");
      if (list) list.innerHTML = '<p class="sidebar-hint">资金结构已升级，请刷新 board.json</p>';
      return;
    }

    var totalEl = document.getElementById("money-total");
    var cashEl = document.getElementById("money-cash");
    var liabEl = document.getElementById("money-liabilities");
    var list = document.getElementById("money-list");
    var shortEl = document.getElementById("shortfall-list");
    var infoEl = document.getElementById("money-info");

    var cash = money.cashOnHand && money.cashOnHand.amount;
    var liabs = money.liabilities || [];
    var liabSum = 0;
    var knownLiab = 0;
    liabs.forEach(function (l) {
      if (l.amount != null && !isNaN(Number(l.amount))) {
        liabSum += Number(l.amount);
        knownLiab++;
      }
    });

    if (totalEl) {
      totalEl.innerHTML =
        '<div class="label">手头可用现金（' +
        escapeHtml(money.asOf || "—") +
        "）</div>" +
        '<div class="amount">' +
        formatCNY(cash) +
        "</div>" +
        '<div class="sub">' +
        escapeHtml((money.cashOnHand && money.cashOnHand.note) || "") +
        "</div>" +
        '<div class="sub">已知负债本金合计 ' +
        formatCNY(knownLiab ? liabSum : null) +
        "（" +
        knownLiab +
        " 项快照）</div>";
    }

    if (cashEl) {
      var hist = (money.historicalCash || [])
        .map(function (h) {
          return (
            '<div class="meta">历史 ' +
            escapeHtml(h.asOf) +
            " ≈ " +
            formatCNY(h.amount) +
            " — " +
            escapeHtml(h.note || "") +
            "</div>"
          );
        })
        .join("");
      cashEl.innerHTML = hist
        ? '<div class="money-item"><div class="name">历史现金快照</div>' + hist + "</div>"
        : "";
    }

    if (liabEl) {
      liabEl.innerHTML = "";
      var title = document.createElement("div");
      title.className = "section-title-sm";
      title.textContent = "负债快照";
      liabEl.appendChild(title);
      liabs.forEach(function (l) {
        var div = document.createElement("div");
        div.className = "money-item";
        div.innerHTML =
          '<div class="row"><span class="name">' +
          escapeHtml(l.name) +
          '</span><span class="bal neg">' +
          formatCNY(l.amount) +
          "</span></div>" +
          '<div class="meta">截至 ' +
          escapeHtml(l.asOf || "—") +
          (l.note ? " · " + escapeHtml(l.note) : "") +
          "</div>";
        liabEl.appendChild(div);
      });
    }

    if (list) {
      list.innerHTML = "";
      (money.loops || []).forEach(function (item) {
        var balNull = item.balance == null;
        var budNull = item.budget == null;
        var shortAmt = computableShortfall(item);
        var div = document.createElement("div");
        div.className =
          "money-item" + (shortAmt != null && shortAmt > 0 ? " short" : "");
        div.innerHTML =
          '<div class="row"><span class="name">' +
          escapeHtml(item.name) +
          '</span><span class="bal ' +
          (balNull ? "pending" : Number(item.balance) < 0 ? "neg" : "ok") +
          '">' +
          (balNull ? "待核验" : formatCNY(item.balance)) +
          "</span></div>" +
          '<div class="meta">预算 ' +
          (budNull ? "待核验" : formatCNY(item.budget)) +
          (item.status ? " · " + escapeHtml(item.status) : "") +
          (shortAmt != null && shortAmt > 0
            ? ' · <span style="color:var(--danger)">缺口 ' + formatCNY(shortAmt) + "</span>"
            : "") +
          "</div>" +
          (item.note ? '<div class="meta">' + escapeHtml(item.note) + "</div>" : "");
        list.appendChild(div);
      });
    }

    var shorts = [];
    (money.shortfalls || []).forEach(function (s) {
      shorts.push(s);
    });
    (money.loops || []).forEach(function (item) {
      var amt = computableShortfall(item);
      if (amt != null && amt > 0) {
        shorts.push({ name: item.name, amount: amt });
      }
    });

    if (shortEl) {
      if (!shorts.length) {
        shortEl.innerHTML =
          '<h3 style="color:var(--success)">无可计算短缺</h3>' +
          '<p class="meta">仅在余额与预算均为数字，或余额&lt;0 时计算；不发明缺口。</p>';
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
                " — " +
                formatCNY(s.amount != null ? s.amount : s.gap) +
                "</li>"
              );
            })
            .join("") +
          "</ul>";
      }
    }

    if (infoEl && money.upcomingObligationsNote) {
      var n = money.upcomingObligationsNote;
      infoEl.innerHTML =
        '<div class="money-item info"><div class="name">' +
        escapeHtml(n.label || "备注") +
        '</div><div class="meta">截至 ' +
        escapeHtml(n.asOf || "") +
        '</div><div class="meta">' +
        escapeHtml(n.text || "") +
        "</div></div>";
    }
  }

  function renderAll(board) {
    renderHeader(board);
    renderKanban(board);
    renderGantt(board);
    renderMoney(board.money || {});
  }

  async function main() {
    var status = document.getElementById("status");
    try {
      var board = await loadBoardJson();
      renderAll(board);
      if (status) status.style.display = "none";
      var enriched = await tryLiveGithub(board);
      if (enriched !== board && enriched._liveSource) {
        renderHeader(enriched);
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
