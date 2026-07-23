import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renameContent,
  isOriginRepo,
  shouldProcessFile,
  isExcludedDir,
} from "./bootstrap-lib.mjs";

const NEW = { scope: "@acme", owner: "Acme", login: "acme" };

test("renameContent: scope import", () => {
  assert.equal(renameContent("import x from '@dentvega/ui-kit'", NEW), "import x from '@acme/ui-kit'");
});
test("renameContent: owner URL", () => {
  assert.equal(renameContent("github.com/DentVega/miniapp-template", NEW), "github.com/Acme/miniapp-template");
});
test("renameContent: workflow uses", () => {
  assert.equal(
    renameContent("uses: DentVega/miniapp-template/.github/workflows/publish.yml@main", NEW),
    "uses: Acme/miniapp-template/.github/workflows/publish.yml@main",
  );
});
test("renameContent: login fixture", () => {
  assert.equal(renameContent('const ADMIN = "dentvega";', NEW), 'const ADMIN = "acme";');
});
test("renameContent: all three together, no corruption", () => {
  assert.equal(renameContent("@dentvega/ui-kit DentVega dentvega", NEW), "@acme/ui-kit Acme acme");
});
test("renameContent: no-op when nothing matches", () => {
  assert.equal(renameContent("nothing here", NEW), "nothing here");
});

test("isOriginRepo", () => {
  assert.equal(isOriginRepo("https://github.com/DentVega/backstage-web.git"), true);
  assert.equal(isOriginRepo("git@github.com:DentVega/x.git"), true);
  assert.equal(isOriginRepo("https://github.com/Acme/backstage-web"), false);
  assert.equal(isOriginRepo(""), false);
  assert.equal(isOriginRepo(undefined), false);
});

test("shouldProcessFile: includes source/config", () => {
  assert.equal(shouldProcessFile("package.json"), true);
  assert.equal(shouldProcessFile("src/x.ts"), true);
  assert.equal(shouldProcessFile(".npmrc"), true);
});
test("shouldProcessFile: excludes lockfiles, own scripts, binaries, dotfiles", () => {
  assert.equal(shouldProcessFile("pnpm-lock.yaml"), false);
  assert.equal(shouldProcessFile("scripts/bootstrap-lib.mjs"), false);
  assert.equal(shouldProcessFile("scripts/bootstrap.mjs"), false);
  assert.equal(shouldProcessFile("node_modules/x/index.js"), false);
  assert.equal(shouldProcessFile("public/logo.png"), false);
  assert.equal(shouldProcessFile(".gitignore"), false);
});
test("isExcludedDir", () => {
  assert.equal(isExcludedDir("node_modules"), true);
  assert.equal(isExcludedDir(".git"), true);
  assert.equal(isExcludedDir("src"), false);
});
