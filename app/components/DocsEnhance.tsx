"use client";

import { useEffect } from "react";

/** Sin render visual: agrega un botón "Copiar" a cada bloque de código de la doc. */
export function DocsEnhance() {
  useEffect(() => {
    const pres = document.querySelectorAll<HTMLElement>(".doc-body pre");
    pres.forEach((pre) => {
      // Colgar el botón de la <figure> (no scrollea con el código); fallback al <pre>.
      const host = (pre.closest("figure") as HTMLElement | null) ?? pre;
      if (host.querySelector(".copy-btn")) return;
      host.classList.add("has-copy");
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.textContent = "Copiar";
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code");
        const text = code?.textContent ?? pre.textContent ?? "";
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
      host.appendChild(btn);
    });
  }, []);

  return null;
}
