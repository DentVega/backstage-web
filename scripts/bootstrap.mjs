#!/usr/bin/env node
/**
 * Adoption bootstrap: rename @dentvega/DentVega to a new company's scope/owner
 * across this repo (a template copy). Dry-run by default; --yes writes.
 *
 * Usage:
 *   node scripts/bootstrap.mjs --scope @acme --owner Acme [--login acme] [--yes] [--force]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  renameContent,
  isOriginRepo,
  isExcludedDir,
  shouldProcessFile,
} from "./bootstrap-lib.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") args.yes = true;
    else if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--scope") args.scope = argv[++i];
    else if (a === "--owner") args.owner = argv[++i];
    else if (a === "--login") args.login = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.scope || !args.owner || !args.scope.startsWith("@")) {
  console.error("usage: node scripts/bootstrap.mjs --scope @acme --owner Acme [--login acme] [--yes] [--force]");
  console.error("  --scope must start with '@'; --owner required. Dry-run unless --yes.");
  process.exit(1);
}
const opts = { scope: args.scope, owner: args.owner, login: args.login ?? args.owner.toLowerCase() };
const write = Boolean(args.yes);

// Origin guard: refuse to WRITE on the DentVega origin repos unless --force.
if (write && !args.force) {
  let remote = "";
  try {
    remote = execSync("git remote get-url origin", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    remote = "";
  }
  if (isOriginRepo(remote)) {
    console.error(`Refusing to write: this looks like the origin repo (${remote}).`);
    console.error("Run bootstrap in a template copy / fork, or pass --force if you really mean it.");
    process.exit(1);
  }
}

// Walk the repo, pruning excluded dirs.
const root = process.cwd();
function walk(dir, rel) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (rel === "" && name === ".git") continue;
    const relPath = rel ? `${rel}/${name}` : name;
    const full = `${dir}/${name}`;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (isExcludedDir(name)) continue;
      found.push(...walk(full, relPath));
    } else if (shouldProcessFile(relPath)) {
      found.push(relPath);
    }
  }
  return found;
}

const count = (text, re) => (text.match(re) || []).length;
const changed = [];
const totals = { scope: 0, owner: 0, login: 0 };

for (const rel of walk(root, "")) {
  const before = readFileSync(`${root}/${rel}`, "utf8");
  const after = renameContent(before, opts);
  if (after === before) continue;
  const cScope = count(before, /@dentvega/g);
  const cOwner = count(before, /DentVega/g);
  const cLogin = count(before, /dentvega/g) - cScope; // standalone lowercase login
  changed.push({ rel, cScope, cOwner, cLogin });
  totals.scope += cScope;
  totals.owner += cOwner;
  totals.login += cLogin;
  if (write) writeFileSync(`${root}/${rel}`, after, "utf8");
}

for (const c of changed) {
  console.log(`  ${c.rel}  (@dentvega:${c.cScope} DentVega:${c.cOwner} dentvega:${c.cLogin})`);
}
console.log(
  `\n${changed.length} archivos · @dentvega→${opts.scope}: ${totals.scope} · DentVega→${opts.owner}: ${totals.owner} · dentvega→${opts.login}: ${totals.login}`,
);
if (write) {
  console.log("Hecho. Ahora corré `pnpm install` para regenerar el lockfile, y seguí SETUP.md desde §3.2.");
} else {
  console.log("dry-run: nada escrito. Corré con --yes para aplicar.");
}
