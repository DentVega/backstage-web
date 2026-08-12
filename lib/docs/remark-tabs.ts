/**
 * Plugin remark: convierte las directivas de contenedor `:::tabs` / `:::tab{label="X"}`
 * en <div class="tabs"> / <div class="tab" data-label="X">. El contenido interno sigue
 * siendo markdown real (code blocks resaltados, etc.). La interactividad la agrega
 * DocsEnhance en el cliente.
 *
 * Uso en el .md:
 *   ::::tabs
 *   :::tab{label="Android"}
 *   ```bash
 *   pnpm android
 *   ```
 *   :::
 *   :::tab{label="iOS"}
 *   ```bash
 *   pnpm ios
 *   ```
 *   :::
 *   ::::
 */
type MdNode = {
  type: string;
  name?: string;
  attributes?: Record<string, string> | null;
  data?: Record<string, unknown>;
  children?: MdNode[];
};

export function remarkTabs() {
  return (tree: MdNode): void => {
    const walk = (node: MdNode): void => {
      if (node.type === "containerDirective") {
        if (node.name === "tabs") {
          node.data = { ...node.data, hName: "div", hProperties: { className: ["tabs"] } };
        } else if (node.name === "tab") {
          const label = node.attributes?.label ?? "Tab";
          node.data = {
            ...node.data,
            hName: "div",
            hProperties: { className: ["tab"], "data-label": label },
          };
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}
