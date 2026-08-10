import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MaintainersControl } from "@/app/components/MaintainersControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("MaintainersControl", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
  });

  it("muestra los maintainers actuales con botón de quitar", () => {
    render(<MaintainersControl id="acc" maintainers={["alice", "bob"]} />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar bob" })).toBeInTheDocument();
  });

  it("estado vacío cuando no hay maintainers", () => {
    render(<MaintainersControl id="acc" maintainers={[]} />);
    expect(screen.getByText(/Sin maintainers/)).toBeInTheDocument();
  });

  it("agrega un login y guarda (PUT)", async () => {
    render(<MaintainersControl id="acc" maintainers={[]} />);
    fireEvent.change(screen.getByLabelText("Agregar maintainer"), { target: { value: "carol" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(screen.getByText("carol")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/miniapps/acc/maintainers",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });
});
