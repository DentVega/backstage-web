/**
 * Plugin rehype: convierte blockquotes con sintaxis GitHub `> [!TIPO]` en callouts
 * estilados (Nota / Tip / Importante / Atención / Cuidado). Contenido propio confiable.
 */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const TYPES: Record<string, { cls: string; label: string; icon: string }> = {
  NOTE: { cls: "note", label: "Nota", icon: "i" },
  TIP: { cls: "tip", label: "Tip", icon: "✦" },
  IMPORTANT: { cls: "important", label: "Importante", icon: "★" },
  WARNING: { cls: "warning", label: "Atención", icon: "▲" },
  CAUTION: { cls: "caution", label: "Cuidado", icon: "✕" },
};

function transform(bq: HastNode): void {
  const firstP = bq.children?.find((c) => c.type === "element" && c.tagName === "p");
  const head = firstP?.children?.[0];
  if (!firstP || head?.type !== "text" || typeof head.value !== "string") return;

  const m = head.value.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/);
  if (m === null) return;
  const info = TYPES[m[1]!]!;

  head.value = head.value.slice(m[0].length);
  // Si el marcador estaba solo en su línea, el 1º párrafo queda vacío → lo sacamos.
  const pText = (firstP.children ?? [])
    .map((c) => (c.type === "text" ? c.value ?? "" : ""))
    .join("")
    .trim();
  const onlyText = (firstP.children ?? []).every((c) => c.type === "text");
  if (pText === "" && onlyText) {
    bq.children = (bq.children ?? []).filter((c) => c !== firstP);
  }

  bq.tagName = "div";
  bq.properties = { className: ["callout", `callout-${info.cls}`] };
  bq.children!.unshift({
    type: "element",
    tagName: "p",
    properties: { className: ["callout-title"] },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { className: ["callout-icon"], ariaHidden: "true" },
        children: [{ type: "text", value: info.icon }],
      },
      { type: "text", value: ` ${info.label}` },
    ],
  });
}

export function rehypeCallouts() {
  return (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      for (const child of node.children ?? []) {
        if (child.type === "element" && child.tagName === "blockquote") transform(child);
        walk(child);
      }
    };
    walk(tree);
  };
}
