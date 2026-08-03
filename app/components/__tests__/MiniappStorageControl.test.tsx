import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniappStorageControl } from "@/app/components/MiniappStorageControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const base = {
  id: "cards_wallet",
  available: ["r2", "blob"],
  defaultProvider: "r2",
  effective: "r2",
  source: "env",
};

describe("MiniappStorageControl", () => {
  it("muestra 'Default (...)' + un radio por available", () => {
    render(<MiniappStorageControl {...base} override={null} />);
    expect(screen.getByLabelText("Default (Cloudflare R2)")).toBeInTheDocument();
    expect(screen.getByLabelText("Cloudflare R2")).toBeInTheDocument();
    expect(screen.getByLabelText("Vercel Blob")).toBeInTheDocument();
  });
  it("sin override → Default seleccionado y Guardar deshabilitado", () => {
    render(<MiniappStorageControl {...base} override={null} />);
    expect(screen.getByLabelText("Default (Cloudflare R2)")).toBeChecked();
    expect(screen.getByRole("button", { name: /Guardar/ })).toBeDisabled();
  });
  it("con override → ese radio seleccionado", () => {
    render(<MiniappStorageControl {...base} override="blob" effective="blob" source="miniapp" />);
    expect(screen.getByLabelText("Vercel Blob")).toBeChecked();
  });
});
