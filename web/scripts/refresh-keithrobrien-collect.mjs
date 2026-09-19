/**
 * Daily cron job: regenerate keithrobrien.com's two album-data JSON files
 * from album-case's Turso DB, and if either changed, push the update to a
 * dedicated `album-refresh` branch (never main) for Keith to review and
 * merge himself.
 *
 * Runs against a DEDICATED CLONE (KRO_CLONE_DIR), never Keith's live working
 * copy of keithrobrien.com -- this job resets/force-pushes freely, and doing
 * that against a directory he actively edits in Claude Code sessions would
 * risk discarding in-progress uncommitted work. The clone is self-healing
 * (cloned fresh if missing) and disposable.
 *
 * The `album-refresh` branch is rebuilt from current origin/main on every
 * run and force-pushed -- it is written ONLY by this job, so that's safe;
 * main itself is never touched.
 *
 * Change detection diffs the fresh export against whichever is more current:
 * origin/album-refresh if it still exists (not yet merged/deleted), else
 * origin/main. Diffing against main unconditionally would re-detect the same
 * pending diff and re-push every single run until Keith actually merges --
 * diffing against the still-open branch instead makes a rerun a true no-op
 * unless something genuinely new happened in Turso since the last push.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/refresh-keithrobrien-collect.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const ALBUM_CASE_DIR = "/Users/keithobrien/Desktop/Claude/Projects/album-case";
const KRO_CLONE_DIR = "/Users/keithobrien/Desktop/Claude/Projects/keithrobrien-cron-clone";
const KRO_REMOTE = "git@github.com:k-obrien17/keithrobrien.git";
const DEPLOY_KEY = "/Users/keithobrien/.ssh/keithrobrien-collect-deploy";
const BRANCH = "album-refresh";
const FILES = ["content/collect/albums.json", "content/collect/album-of-year.json"];

const GIT_SSH_COMMAND = `ssh -i ${DEPLOY_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;

function run(cmd, args, cwd, extraEnv = {}) {
  return execFileSync(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function git(args, extraEnv = {}) {
  return run("git", args, KRO_CLONE_DIR, extraEnv);
}

console.log(`=== ${new Date().toISOString()} keithrobrien-collect-refresh ===`);

// 0. Self-heal: clone if the dedicated working copy doesn't exist yet.
if (!existsSync(KRO_CLONE_DIR)) {
  console.log(`Cloning ${KRO_REMOTE} into ${KRO_CLONE_DIR}...`);
  run(
    "git",
    ["clone", KRO_REMOTE, KRO_CLONE_DIR],
    "/Users/keithobrien/Desktop/Claude/Projects",
    { GIT_SSH_COMMAND },
  );
}

// 1. Always start from a clean, current main -- safe here, this clone holds
//    no work of Keith's, only ever what this job put there.
git(["fetch", "origin", "main"], { GIT_SSH_COMMAND });
git(["checkout", "main"]);
git(["reset", "--hard", "origin/main"]);

// 2. Regenerate both files straight into the clone (COLLECT_OUT override,
//    same knob export-collect-albums.mjs and export-album-of-year.mjs
//    already support) -- never Keith's live working copy.
const [albumsOut, albumOfYearOut] = FILES.map((f) => `${KRO_CLONE_DIR}/${f}`);
run(
  "node",
  ["--env-file=web/.env.local", "web/scripts/export-collect-albums.mjs"],
  ALBUM_CASE_DIR,
  { COLLECT_OUT: albumsOut },
);
run(
  "node",
  ["--env-file=web/.env.local", "web/scripts/export-album-of-year.mjs"],
  ALBUM_CASE_DIR,
  { COLLECT_OUT: albumOfYearOut },
);

// 3. Diff against the still-open branch if one exists (so a rerun before
//    Keith merges is a no-op unless something genuinely new happened),
//    otherwise against main.
let baselineRef = "origin/main";
const remoteRefreshSha = git(["ls-remote", "origin", `refs/heads/${BRANCH}`]).trim();
if (remoteRefreshSha) {
  git(["fetch", "origin", `${BRANCH}:refs/remotes/origin/${BRANCH}`], { GIT_SSH_COMMAND });
  baselineRef = `origin/${BRANCH}`;
}

const diff = git(["diff", "--stat", baselineRef, "--", ...FILES]).trim();
if (!diff) {
  console.log(`No change vs. ${baselineRef}. Nothing to do.`);
  console.log(`OK ${new Date().toISOString()}`);
  process.exit(0);
}

console.log(`Changed vs. ${baselineRef}:\n${diff}`);

// 4. Rebuild the bot-owned branch fresh off current main and force-push.
git(["checkout", "-B", BRANCH]);
git(["add", ...FILES]);
git(
  [
    "commit",
    "-m",
    "chore(collect): refresh album data from album-case\n\nAutomated daily refresh. Review and merge to deploy.",
  ],
);
git(["push", "--force", "-u", "origin", BRANCH], { GIT_SSH_COMMAND });
git(["checkout", "main"]);

console.log(`Pushed ${BRANCH} with updated album data. Review + merge at:`);
console.log(`  https://github.com/k-obrien17/keithrobrien/compare/main...${BRANCH}`);
console.log(`OK ${new Date().toISOString()}`);
