#!/usr/bin/env node
/**
 * sync-from-github.mjs
 * Refresh data/board.json from GitHub metadata (issues, commits, branches).
 * Money fields are preserved from existing board.json / config — GitHub has no money API.
 *
 * Usage:
 *   node scripts/sync-from-github.mjs
 *   GITHUB_TOKEN=xxx node scripts/sync-from-github.mjs
 *   # or rely on `gh` CLI auth:
 *   gh auth token | …  (script auto-detects gh)
 *
 * Default target: liujiadong1237-jpg/personal-evolution-system
 * Extra repos: config.json → sourceRepos
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
    // simple page bump
    const page = i + 2;
    url = path.includes("?")
      ? path + "&per_page=100&page=" + page
      : path + "?per_page=100&page=" + page;
  }
  return items;
}

function matchProject(issueOrBranch, projectsCfg) {
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

  for (const p of projectsCfg) {
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

async function syncRepo(repo, token, projectsCfg) {
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

  const perProject = {};
  for (const p of projectsCfg) {
    perProject[p.id] = {
      openIssues: 0,
      closedIssues: 0,
      commits: 0,
      branches: [],
    };
  }

  for (const issue of pureIssues) {
    const id = matchProject(issue, projectsCfg);
    if (!id || !perProject[id]) continue;
    if (issue.state === "open") perProject[id].openIssues++;
    else perProject[id].closedIssues++;
  }

  for (const b of branches) {
    const id = matchProject({ name: b.name }, projectsCfg);
    if (id && perProject[id]) perProject[id].branches.push(b.name);
  }

  // Commits are repo-level; distribute a count hint, or leave on meta
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
    perProject,
  };
}

async function main() {
  const config = loadJson(CONFIG_PATH, {});
  const board = loadJson(BOARD_PATH, {
    projects: [],
    money: [],
    sourceRepos: [],
  });

  const token = getToken();
  if (!token) {
    console.warn(
      "No GITHUB_TOKEN / gh auth token found. Will write timestamp-only update; GitHub fields stay as-is."
    );
  }

  const repos = config.sourceRepos ||
    board.sourceRepos || [config.defaultSourceRepo || "liujiadong1237-jpg/personal-evolution-system"];
  const projectsCfg = config.projects || [];

  const metas = [];
  if (token) {
    for (const repo of repos) {
      try {
        metas.push(await syncRepo(repo, token, projectsCfg));
      } catch (e) {
        console.error("Failed " + repo + ":", e.message);
      }
    }
  }

  // Merge GitHub stats into existing projects (preserve progress/stage/deadline/money)
  const mergedMeta = metas[0] || null;
  const projects = (board.projects || []).map(function (p) {
    const stats =
      (mergedMeta && mergedMeta.perProject && mergedMeta.perProject[p.id]) ||
      p.github ||
      {};
    return Object.assign({}, p, {
      github: {
        openIssues: stats.openIssues != null ? stats.openIssues : (p.github && p.github.openIssues) || 0,
        closedIssues:
          stats.closedIssues != null ? stats.closedIssues : (p.github && p.github.closedIssues) || 0,
        commits: stats.commits != null ? stats.commits : (p.github && p.github.commits) || 0,
        branches: stats.branches || (p.github && p.github.branches) || [],
      },
    });
  });

  // Money: keep existing; never invent from GitHub
  const money = board.money || [];

  const out = {
    updatedAt: new Date().toISOString(),
    source: token ? "sync" : board.source || "seed",
    sourceRepos: repos,
    projects,
    money,
    githubMeta: {
      defaultRepo: config.defaultSourceRepo || repos[0],
      lastSync: new Date().toISOString(),
      issuesTotal: mergedMeta ? mergedMeta.issuesTotal : (board.githubMeta && board.githubMeta.issuesTotal) || 0,
      openIssues: mergedMeta ? mergedMeta.openIssues : (board.githubMeta && board.githubMeta.openIssues) || 0,
      closedIssues:
        mergedMeta ? mergedMeta.closedIssues : (board.githubMeta && board.githubMeta.closedIssues) || 0,
      commitsRecent:
        mergedMeta ? mergedMeta.commitsRecent : (board.githubMeta && board.githubMeta.commitsRecent) || 0,
      branches: mergedMeta ? mergedMeta.branches : (board.githubMeta && board.githubMeta.branches) || [],
    },
  };

  writeFileSync(BOARD_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("Wrote " + BOARD_PATH);
  console.log(
    "Projects: " +
      projects.length +
      ", money rows: " +
      money.length +
      ", issues: " +
      out.githubMeta.issuesTotal
  );
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
