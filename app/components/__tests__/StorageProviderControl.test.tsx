import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StorageProviderControl } from "@/app/components/StorageProviderControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("StorageProviderControl", () => {
  it("renderiza un radio por provider disponible con labels legibles", () => {
    render(<StorageProviderControl available={["r2", "blob"]} active="r2" source="env" />);
    expect(screen.getByLabelText("Cloudflare R2")).toBeInTheDocument();
    expect(screen.getByLabelText("Vercel Blob")).toBeInTheDocument();
  });
  it("el radio del activo arranca seleccionado", () => {
    render(<StorageProviderControl available={["r2", "blob"]} active="blob" source="preference" />);
    expect(screen.getByLabelText("Vercel Blob")).toBeChecked();
  });
  it("Guardar arranca deshabilitado (elegido == activo)", () => {
    render(<StorageProviderControl available={["r2", "blob"]} active="r2" source="env" />);
    expect(screen.getByRole("button", { name: /Guardar/ })).toBeDisabled();
  });
});
