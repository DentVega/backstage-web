import { describe, it, expect } from "vitest";
import { rewriteHref } from "./rehype-doc-links";

describe("rewriteHref", () => {
  it("deja intactos anchors same-page, absolutos y con protocolo", () => {
    expect(rewriteHref("#seccion")).toBeNull();
    expect(rewriteHref("/docs/setup")).toBeNull();
    expect(rewriteHref("/catalog")).toBeNull();
    expect(rewriteHref("https://github.com/x/y")).toBeNull();
    expect(rewriteHref("http://example.com")).toBeNull();
    expect(rewriteHref("mailto:x@y.com")).toBeNull();
    expect(rewriteHref("")).toBeNull();
  });

  it("mapea un .md del sitio a /docs/<slug>, preservando el anchor", () => {
    expect(rewriteHref("./SETUP.md")).toBe("/docs/setup");
    expect(rewriteHref("./SETUP.md#2-prerrequisitos")).toBe("/docs/setup#2-prerrequisitos");
    expect(rewriteHref("./LOCAL-DEV.md#7-troubleshooting")).toBe("/docs/local-dev#7-troubleshooting");
    // el slug puede diferir del nombre de archivo
    expect(rewriteHref("./activar-compat-gates.md")).toBe("/docs/compat-gates");
    expect(rewriteHref("./miniapps-guide.md")).toBe("/docs/miniapps-guide");
  });

  it("es case-insensitive en el nombre de archivo", () => {
    expect(rewriteHref("./setup.md")).toBe("/docs/setup");
  });

  it("manda un archivo del repo backstage-web a su GitHub blob", () => {
    expect(rewriteHref("../DEPLOY.md")).toBe(
      "https://github.com/DentVega/backstage-web/blob/main/DEPLOY.md",
    );
    expect(rewriteHref("../lib/http.ts")).toBe(
      "https://github.com/DentVega/backstage-web/blob/main/lib/http.ts",
    );
    expect(rewriteHref("../README.md")).toBe(
      "https://github.com/DentVega/backstage-web/blob/main/README.md",
    );
  });

  it("manda un archivo de un repo hermano a su GitHub blob", () => {
    expect(rewriteHref("../../backstagereactnative/README.md")).toBe(
      "https://github.com/DentVega/backstagereactnative/blob/main/README.md",
    );
  });

  it("preserva el anchor en los links a GitHub", () => {
    expect(rewriteHref("../DEPLOY.md#storage")).toBe(
      "https://github.com/DentVega/backstage-web/blob/main/DEPLOY.md#storage",
    );
  });
});
