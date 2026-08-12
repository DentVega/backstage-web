/**
 * Temas Shiki propios "Registry Console" (light + dark) para los code blocks de las
 * docs. Paleta de la marca: keywords en ámbar (--accent), strings en teal (--wire),
 * comentarios tenues. keepBackground:false → el fondo lo pone .doc-body pre (--surface-2).
 */
import type { ThemeRegistrationRaw } from "shiki";

export const registryDark: ThemeRegistrationRaw = {
  name: "registry-console-dark",
  type: "dark",
  colors: { "editor.foreground": "#cdd3de", "editor.background": "#161b23" },
  settings: [
    { settings: { foreground: "#cdd3de" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#7a8494", fontStyle: "italic" } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new", "keyword.operator.expression", "keyword.control.import", "keyword.control.export"], settings: { foreground: "#ffb02e" } },
    { scope: ["string", "string.quoted", "string.template", "punctuation.definition.string", "string.regexp"], settings: { foreground: "#57c7bd" } },
    { scope: ["constant.numeric", "constant.language", "constant.language.boolean", "support.constant", "constant.character"], settings: { foreground: "#e0a860" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call.generic", "meta.function-call"], settings: { foreground: "#e7eaf0" } },
    { scope: ["entity.name.type", "support.type", "entity.name.class", "support.class", "entity.other.inherited-class"], settings: { foreground: "#7fd6cc" } },
    { scope: ["variable", "variable.other", "meta.definition.variable", "variable.parameter", "variable.other.readwrite"], settings: { foreground: "#c3cad6" } },
    { scope: ["variable.other.property", "meta.object-literal.key", "support.type.property-name", "variable.other.object.property"], settings: { foreground: "#c3cad6" } },
    { scope: ["punctuation", "meta.brace", "meta.delimiter", "punctuation.separator", "punctuation.terminator"], settings: { foreground: "#8b94a3" } },
    { scope: ["entity.name.tag", "punctuation.definition.tag"], settings: { foreground: "#ffb02e" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#57c7bd" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  ],
};

export const registryLight: ThemeRegistrationRaw = {
  name: "registry-console-light",
  type: "light",
  colors: { "editor.foreground": "#2a2f38", "editor.background": "#f2efe8" },
  settings: [
    { settings: { foreground: "#2a2f38" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#93907f", fontStyle: "italic" } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new", "keyword.operator.expression", "keyword.control.import", "keyword.control.export"], settings: { foreground: "#b9760a" } },
    { scope: ["string", "string.quoted", "string.template", "punctuation.definition.string", "string.regexp"], settings: { foreground: "#1f7a70" } },
    { scope: ["constant.numeric", "constant.language", "constant.language.boolean", "support.constant", "constant.character"], settings: { foreground: "#a2611c" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call.generic", "meta.function-call"], settings: { foreground: "#2a2f38" } },
    { scope: ["entity.name.type", "support.type", "entity.name.class", "support.class", "entity.other.inherited-class"], settings: { foreground: "#177065" } },
    { scope: ["variable", "variable.other", "meta.definition.variable", "variable.parameter", "variable.other.readwrite"], settings: { foreground: "#3a4048" } },
    { scope: ["variable.other.property", "meta.object-literal.key", "support.type.property-name", "variable.other.object.property"], settings: { foreground: "#3a4048" } },
    { scope: ["punctuation", "meta.brace", "meta.delimiter", "punctuation.separator", "punctuation.terminator"], settings: { foreground: "#6b7078" } },
    { scope: ["entity.name.tag", "punctuation.definition.tag"], settings: { foreground: "#b9760a" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#1f7a70" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  ],
};
