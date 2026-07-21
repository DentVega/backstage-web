import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniappHeader } from "@/app/components/MiniappHeader";
import type { MiniappDetail } from "@/lib/registry/types";
import type { MiniappId, SemVer } from "@dentvega/miniapp-contract";

const base: MiniappDetail = {
  id: "account_dashboard" as MiniappId,
  name: "Account Dashboard",
  owner: "payments-team",
  createdAt: "2026-07-09T10:00:00.000Z",
  repoUrl: "https://github.com/acme/miniapp-account_dashboard",
  latestVersion: "0.1.0" as SemVer,
  versionCount: 1,
  versions: [],
  capabilities: [],
};

describe("MiniappHeader", () => {
  it("renders name, owner, version, created date and repo link", () => {
    render(<MiniappHeader detail={base} />);
    expect(screen.getByRole("heading", { name: /Account Dashboard/ })).toBeInTheDocument();
    expect(screen.getByText("payments-team")).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /miniapp-account_dashboard/ });
    expect(link).toHaveAttribute("href", base.repoUrl);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("omits repo/created rows and shows 'sin versiones' when absent", () => {
    render(
      <MiniappHeader
        detail={{ ...base, createdAt: undefined, repoUrl: undefined, latestVersion: null }}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/sin versiones/i)).toBeInTheDocument();
  });
});
