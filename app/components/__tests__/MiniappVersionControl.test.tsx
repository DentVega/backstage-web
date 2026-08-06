import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniappVersionControl } from "@/app/components/MiniappVersionControl";
import type { VersionView } from "@/lib/registry/types";
import type { SemVer } from "@dentvega/miniapp-contract";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const v = (version: string): VersionView => ({
  version: version as SemVer,
  url: `u/${version}`,
  publishedAt: "2026-08-06T10:00:00.000Z",
  capabilities: [],
});
const versions = [v("0.3.0"), v("0.2.0"), v("0.1.0")];

describe("MiniappVersionControl", () => {
  it("select con 'Automática (última: v0.3.0)' + una opción por versión", () => {
    render(
      <MiniappVersionControl id="acc" versions={versions} servedVersion={"0.3.0" as SemVer} latestVersion={"0.3.0" as SemVer} />,
    );
    expect(screen.getByRole("combobox")).toHaveValue("__auto__");
    expect(screen.getByRole("option", { name: /Automática \(última: v0.3.0\)/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "v0.1.0" })).toBeInTheDocument();
  });

  it("con pin: el select preselecciona la versión fijada", () => {
    render(
      <MiniappVersionControl id="acc" versions={versions} pinnedVersion="0.1.0" servedVersion={"0.1.0" as SemVer} latestVersion={"0.3.0" as SemVer} />,
    );
    expect(screen.getByRole("combobox")).toHaveValue("0.1.0");
  });

  it("aviso cuando la servida no es la última", () => {
    render(
      <MiniappVersionControl id="acc" versions={versions} pinnedVersion="0.1.0" servedVersion={"0.1.0" as SemVer} latestVersion={"0.3.0" as SemVer} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/versión anterior/i);
  });

  it("sin pin (auto = última): sin aviso y 'Aplicar' deshabilitado", () => {
    render(
      <MiniappVersionControl id="acc" versions={versions} servedVersion={"0.3.0" as SemVer} latestVersion={"0.3.0" as SemVer} />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /Aplicar/ })).toBeDisabled();
  });
});
