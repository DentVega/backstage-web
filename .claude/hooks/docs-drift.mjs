#!/usr/bin/env node
/**
 * Hook PostToolUse (matcher Bash): tras un `git commit`, detecta si el commit tocó código
 * doc-relevante (según .claude/docs-map.json) sin actualizar las docs afectadas, y lo avisa
 * vía additionalContext (no bloquea). Cross-repo. Dedup por SHA. Best-effort: siempre exit 0.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function done() { process.exit(0); }

// 1) Input del hook por stdin. Solo actuar si el comando fue un git commit.
let input = {};
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { done(); }
const cmd = input?.tool_input?.command ?? "";
if (!/git\s+commit/.test(cmd)) done();

const ROOT = process.cwd(); // el hook corre con cwd = backstage-web
const MAP_PATH = path.join(ROOT, ".claude/docs-map.json");
const STATE_PATH = path.join(ROOT, ".claude/.docs-drift-state.json");

let rules = [];
try { rules = JSON.parse(readFileSync(MAP_PATH, "utf8")).rules ?? []; } catch { done(); }

// Repos vigilados: "." + los que aparezcan con ../<repo>/ en el map.
const repos = new Set(["."]);
for (const r of rules) for (const p of r.paths ?? []) {
  const m = p.match(/^(\.\.\/[^/]+)\//);
  if (m) repos.add(m[1]);
}

function head(repo) {
  try {
    const sha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const files = execFileSync("git", ["-C", repo, "show", "--name-only", "--format=", "HEAD"], { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    return { sha, files };
  } catch { return null; }
}

let state = {};
try { state = JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch { /* primera vez */ }

// 2) Archivos cambiados = ultimo commit de cada repo, SOLO si su HEAD es nuevo (no visto).
const changed = new Set(); // paths estilo docs-map ("." tal cual; hermanos con prefijo ../repo/)
const heads = {};
for (const repo of repos) {
  const h = head(repo);
  if (!h) continue;
  heads[repo] = h.sha;
  if (state[repo] === h.sha) continue; // ya avisado -> no contribuye (dedup)
  for (const f of h.files) changed.add(repo === "." ? f : `${repo}/${f}`);
}

// 3) glob -> regex (soporta * y **).
function globToRe(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
  return new RegExp("^" + re + "$");
}

// 4) Mapear cambios -> docs/acciones afectadas.
const changedArr = [...changed];
const docs = new Set(), actions = new Set(), reasons = new Set();
for (const rule of rules) {
  const res = (rule.paths ?? []).map(globToRe);
  if (!changedArr.some((f) => res.some((re) => re.test(f)))) continue;
  for (const d of rule.docs ?? []) docs.add(d);
  if (rule.action) actions.add(rule.action);
  if (rule.why) reasons.add(rule.why);
}

// 5) No es drift si la doc ya se toco en este commit.
for (const d of [...docs]) if (changed.has(d)) docs.delete(d);

// 6) Marcar los HEAD como vistos SIEMPRE (drift o no) para no re-avisar.
try { writeFileSync(STATE_PATH, JSON.stringify(heads, null, 2)); } catch { /* ignore */ }

if (docs.size === 0 && actions.size === 0) done();

const parts = [];
if (docs.size) parts.push(`revisá: ${[...docs].join(", ")}`);
if (actions.size) parts.push(`corré: ${[...actions].map((a) => "`" + a + "`").join(", ")}`);
const msg =
  `⚠ Docs drift: el commit tocó código doc-relevante (${[...reasons].join("; ")}). ` +
  `${parts.join(" · ")}. Usá el skill \`docs-sync\` para actualizar la doc.`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg },
}));
done();
