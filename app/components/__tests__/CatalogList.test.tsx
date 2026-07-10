import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CatalogList } from "@/app/components/CatalogList";
import type { CatalogEntry } from "@/lib/registry/types";
import type { MiniappId, SemVer } from "@org/miniapp-contract";

const entry: CatalogEntry = {
  id: "account_dashboard" as MiniappId,
  name: "Account Dashboard",
  owner: "payments-team",
  latestVersion: "0.1.0" as SemVer,
  versionCount: 1,
  createdAt: "2026-07-09T10:00:00.000Z",
  repoUrl: "https://github.com/acme/miniapp-account_dashboard",
};

describe("CatalogList", () => {
  it("renders registered miniapps with a detail link, date and CI badge", () => {
    render(<CatalogList entries={[entry]} statusById={{ account_dashboard: "success" }} />);
    expect(screen.getByText("Account Dashboard")).toBeInTheDocument();
    expect(screen.getByText("account_dashboard")).toBeInTheDocument();
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Account Dashboard/ })).toHaveAttribute(
      "href",
      "/miniapp/account_dashboard",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "CI: success");
  });

  it("falls back to an unknown badge when no status is provided", () => {
    render(<CatalogList entries={[entry]} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "CI: unknown");
  });

  it("shows an empty state when there are no miniapps", () => {
    render(<CatalogList entries={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/No hay miniapps/i);
  });
});
