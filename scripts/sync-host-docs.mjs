#!/usr/bin/env node
/**
 * Sincroniza (copia) los docs del host-repo `backstagereactnative` al sitio de docs de
 * backstage-web. Vercel solo deploya backstage-web, así que los docs del host tienen que
 * estar físicamente acá. Este script es la fuente de la copia — correlo cuando cambien
 * los originales:  node scripts/sync-host-docs.mjs
 *
 * Qué hace por cada doc: le pone un header "espejo de…" y reescribe los links relativos
 * a URLs de GitHub del host-repo (para que no rompan fuera de su repo).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const HOST = "../backstagereactnative"; // repo hermano
const GH = "https://github.com/DentVega/backstagereactnative/blob/main";

const DOCS = [
  { src: "apps/host/RUN.md", srcDir: "apps/host", dest: "docs/HOST-RUN.md" },
  { src: "docs/mounting-miniapps.md", srcDir: "docs", dest: "docs/HOST-MOUNTING.md" },
];

for (const d of DOCS) {
  let md = readFileSync(path.join(HOST, d.src), "utf8");

  // El sitio de docs es público: genericizar info de la instancia real (hostname de
  // producción + paths absolutos de la máquina del maintainer).
  md = md
    .replace(/https:\/\/backstage-web-blond\.vercel\.app/g, "https://<tu-proyecto>.vercel.app")
    .replace(/\/Volumes\/SSDExterno\/prodproyects\//g, "../");

  // Links relativos (./ ../) → URL de GitHub del host-repo, resueltos desde srcDir.
  md = md.replace(/\]\((\.\.?\/[^)]+)\)/g, (_m, rel) => {
    const resolved = path.posix.normalize(path.posix.join(d.srcDir, rel));
    return `](${GH}/${resolved})`;
  });

  // Header "espejo" (callout) después del primer h1.
  const note =
    `\n> [!NOTE]\n> Este doc es un **espejo** de \`${d.src}\` del repo ` +
    `[\`backstagereactnative\`](${GH}/${d.src}). Editalo allá; acá es una copia para el sitio.\n`;
  md = md.replace(/^(# .+\n)/, `$1${note}`);

  writeFileSync(d.dest, md, "utf8");
  console.log(`synced ${d.src} → ${d.dest}`);
}
