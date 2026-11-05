#!/usr/bin/env node
/**
 * sync-from-github.mjs
 * Refresh GitHub meta on data/board.json.
 * PRESERVES: money, columns/cards (progress/stage/deadline/invested/nextAction/bizStatus),
 * scheduleOwner, taxonomyNote, activeSources.
 * Only refreshes githubMeta + per-card github stats.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONFIG_PATH = join(ROOT, "config.json");
const BOARD_PATH = join(ROOT, "data", "board.json");

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function ghFetch(path, token) {
  const url = path.startsWith("http") ? path : "https://api.github.com" + path;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "project-progress-board-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("GitHub API " + res.status + " " + path + ": " + text.slice(0, 200));
  }
  return res.json();
}

async function fetchAllPages(path, token, maxPages = 5) {
  const items = [];
  let url = path.includes("?") ? path + "&per_page=100" : path + "?per_page=100";
  for (let i = 0; i < maxPages; i++) {
    const batch = await ghFetch(url, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
    const page = i + 2;
    url = path.includes("?")
      ? path + "&per_page=100&page=" + page
      : path + "?per_page=100&page=" + page;
  }
  return items;
}

function flattenCardCfg(config) {
  const out = [];
  for (const col of config.columns || []) {
    for (const c of col.cards || []) {
      out.push(Object.assign({}, c, { columnId: col.id }));
    }
  }
  // legacy flat projects
  for (const p of config.projects || []) out.push(p);
  return out;
}

function matchCard(issueOrBranch, cardsCfg) {
  const hay = (
    (issueOrBranch.title || "") +
    " " +
    (issueOrBranch.name || "") +
    " " +
    (issueOrBranch.labels || [])
      .map(function (l) {
        return typeof l === "string" ? l : l.name || "";
      })
      .join(" ")
  ).toLowerCase();

  for (const p of cardsCfg) {
    const hints = []
      .concat(p.githubLabels || [])
      .concat(p.branchHints || [])
      .concat([p.name, p.id]);
    for (const h of hints) {
      if (h && hay.includes(String(h).toLowerCase())) return p.id;
    }
  }
  return null;
}

async function syncRepo(repo, token, cardsCfg) {
  console.log("Syncing " + repo + " …");
  const [issues, commits, branches] = await Promise.all([
    fetchAllPages("/repos/" + repo + "/issues?state=all", token).catch(function (e) {
      console.warn("  issues:", e.message);
      return [];
    }),
    fetchAllPages("/repos/" + repo + "/commits", token, 2).catch(function (e) {
      console.warn("  commits:", e.message);
      return [];
    }),
    fetchAllPages("/repos/" + repo + "/branches", token, 2).catch(function (e) {
      console.warn("  branches:", e.message);
      return [];
    }),
  ]);

  const pureIssues = issues.filter(function (i) {
    return !i.pull_request;
  });

  const perCard = {};
  for (const p of cardsCfg) {
    perCard[p.id] = { openIssues: 0, closedIssues: 0, commits: 0, branches: [] };
  }

  for (const issue of pureIssues) {
    const id = matchCard(issue, cardsCfg);
    if (!id || !perCard[id]) continue;
    if (issue.state === "open") perCard[id].openIssues++;
    else perCard[id].closedIssues++;
  }

  for (const b of branches) {
    const id = matchCard({ name: b.name }, cardsCfg);
    if (id && perCard[id]) perCard[id].branches.push(b.name);
  }

  return {
    repo,
    issuesTotal: pureIssues.length,
    openIssues: pureIssues.filter(function (i) {
      return i.state === "open";
    }).length,
    closedIssues: pureIssues.filter(function (i) {
      return i.state === "closed";
    }).length,
    commitsRecent: commits.length,
    branches: branches.map(function (b) {
      return b.name;
    }),
    perCard,
  };
}

async function main() {
  const config = loadJson(CONFIG_PATH, {});
  const board = loadJson(BOARD_PATH, { columns: [], money: {}, sourceRepos: [] });
  const token = getToken();
  if (!token) console.warn("No token; timestamp-only update.");

  const repos =
    config.sourceRepos ||
    board.sourceRepos || [config.defaultSourceRepo || "liujiadong1237-jpg/personal-evolution-system"];
  const cardsCfg = flattenCardCfg(config);

  const metas = [];
  if (token) {
    for (const repo of repos) {
      try {
        metas.push(await syncRepo(repo, token, cardsCfg));
      } catch (e) {
        console.error("Failed " + repo + ":", e.message);
      }
    }
  }

  const mergedMeta = metas[0] || null;
  const perCard = {};
  for (const m of metas) {
    for (const [id, stats] of Object.entries(m.perCard || {})) {
      if (!perCard[id]) perCard[id] = { openIssues: 0, closedIssues: 0, commits: 0, branches: [] };
      perCard[id].openIssues += stats.openIssues || 0;
      perCard[id].closedIssues += stats.closedIssues || 0;
      perCard[id].branches = (perCard[id].branches || []).concat(stats.branches || []);
    }
  }

  const columns = (board.columns || []).map(function (col) {
    return Object.assign({}, col, {
      cards: (col.cards || []).map(function (card) {
        const stats = perCard[card.id] || card.github || {};
        return Object.assign({}, card, {
          github: {
            openIssues: stats.openIssues != null ? stats.openIssues : (card.github && card.github.openIssues) || 0,
            closedIssues:
              stats.closedIssues != null ? stats.closedIssues : (card.github && card.github.closedIssues) || 0,
            commits: stats.commits != null ? stats.commits : (card.github && card.github.commits) || 0,
            branches: stats.branches || (card.github && card.github.branches) || [],
          },
        });
      }),
    });
  });

  const out = Object.assign({}, board, {
    updatedAt: new Date().toISOString(),
    source: token ? "sync" : board.source || "vault",
    sourceRepos: repos,
    columns,
    money: board.money, // never invent
    scheduleOwner: board.scheduleOwner || config.scheduleOwner,
    taxonomyNote: board.taxonomyNote,
    activeSources: board.activeSources,
    githubMeta: {
      defaultRepo: config.defaultSourceRepo || repos[0],
      lastSync: new Date().toISOString(),
      issuesTotal: mergedMeta ? mergedMeta.issuesTotal : (board.githubMeta && board.githubMeta.issuesTotal) || 0,
      openIssues: mergedMeta ? mergedMeta.openIssues : (board.githubMeta && board.githubMeta.openIssues) || 0,
      closedIssues: mergedMeta ? mergedMeta.closedIssues : (board.githubMeta && board.githubMeta.closedIssues) || 0,
      commitsRecent: mergedMeta ? mergedMeta.commitsRecent : (board.githubMeta && board.githubMeta.commitsRecent) || 0,
      branches: mergedMeta ? mergedMeta.branches : (board.githubMeta && board.githubMeta.branches) || [],
      reposSynced: metas.map(function (m) {
        return m.repo;
      }),
    },
  });
  // drop legacy flat projects if present
  delete out.projects;

  writeFileSync(BOARD_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("Wrote " + BOARD_PATH);
  console.log(
    "Columns: " +
      columns.length +
      ", cards: " +
      columns.reduce(function (n, c) {
        return n + (c.cards || []).length;
      }, 0)
  );
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
