import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VersionList } from "@/app/components/VersionList";
import type { VersionView } from "@/lib/registry/types";
import type { SemVer } from "@dentvega/miniapp-contract";

const v = (version: string, capabilities: string[] = []): VersionView => ({
  version: version as SemVer,
  url: `http://cdn/${version}.js`,
  publishedAt: "2026-07-09T10:00:00.000Z",
  capabilities,
});

describe("VersionList", () => {
  it("renders versions newest-first with date, chunk link and capabilities", () => {
    render(<VersionList versions={[v("1.0.0", ["accounts:read"]), v("0.1.0")]} />);
    const list = screen.getByRole("list", { name: "Versiones" });
    expect(list).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
    expect(screen.getByText(/accounts:read/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "chunk" });
    expect(links[0]).toHaveAttribute("href", "http://cdn/1.0.0.js");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows an empty state without versions", () => {
    render(<VersionList versions={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Sin versiones/i);
  });
});
