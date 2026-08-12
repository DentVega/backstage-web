"use client";

import { useEffect } from "react";

/** Sin render visual: agrega una barra (lenguaje + copiar) a cada code block. */
export function DocsEnhance() {
  useEffect(() => {
    function copyBtn(pre: Element | null): HTMLButtonElement {
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.textContent = "Copiar";
      btn.addEventListener("click", () => {
        const code = pre?.querySelector("code");
        const text = code?.textContent ?? pre?.textContent ?? "";
        navigator.clipboard
          .writeText(text)
          .then(() => {
            btn.textContent = "¡Copiado!";
            window.setTimeout(() => (btn.textContent = "Copiar"), 1400);
          })
          .catch(() => {
            btn.textContent = "Error";
            window.setTimeout(() => (btn.textContent = "Copiar"), 1400);
          });
      });
      return btn;
    }

    // 1) Code blocks con highlighting → barra: lenguaje (izq) + copiar (der).
    document
      .querySelectorAll<HTMLElement>(".doc-body figure[data-rehype-pretty-code-figure]")
      .forEach((fig) => {
        if (fig.querySelector(".code-bar")) return;
        const pre = fig.querySelector("pre");
        const lang = pre?.getAttribute("data-language") || "código";
        const bar = document.createElement("div");
        bar.className = "code-bar";
        const label = document.createElement("span");
        label.className = "code-lang";
        label.textContent = lang;
        bar.append(label, copyBtn(pre));
        fig.classList.add("has-bar");
        fig.insertBefore(bar, fig.firstChild);
      });

    // 2) <pre> sueltos (sin lenguaje/figure) → botón copiar flotante.
    document.querySelectorAll<HTMLElement>(".doc-body pre").forEach((pre) => {
      if (pre.closest("figure[data-rehype-pretty-code-figure]")) return;
      if (pre.querySelector(".copy-btn")) return;
      pre.classList.add("has-copy-float");
      const btn = copyBtn(pre);
      btn.classList.add("copy-btn-float");
      pre.appendChild(btn);
    });
  }, []);

  return null;
}
