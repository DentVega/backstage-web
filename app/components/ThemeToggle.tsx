"use client";

/** Toggles data-theme on <html>, overriding the OS preference for the session. */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    let cur = root.getAttribute("data-theme");
    if (!cur) {
      cur = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
  }
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label="Toggle color theme">
      ◐
    </button>
  );
}
