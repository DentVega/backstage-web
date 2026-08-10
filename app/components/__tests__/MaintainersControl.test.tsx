import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MaintainersControl } from "@/app/components/MaintainersControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** fetch mock: el GET de collaborators devuelve `collabs`; el PUT devuelve ok. */
function mockFetch(collabs: string[]) {
  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({}) });
    if (String(url).endsWith("/collaborators")) {
      return Promise.resolve({ ok: true, json: async () => ({ collaborators: collabs }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }) as unknown as typeof fetch;
}

describe("MaintainersControl", () => {
  beforeEach(() => {
    mockFetch(["carol", "dave"]);
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

  it("agrega un collaborator y guarda (PUT)", async () => {
    render(<MaintainersControl id="acc" maintainers={[]} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/miniapps/acc/collaborators"));
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

  it("NO agrega un login que no es collaborator del repo", async () => {
    render(<MaintainersControl id="acc" maintainers={[]} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/miniapps/acc/collaborators"));
    fireEvent.change(screen.getByLabelText("Agregar maintainer"), { target: { value: "mallory" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(screen.queryByText("mallory")).not.toBeInTheDocument();
    expect(screen.getByText(/no tiene acceso al repo/)).toBeInTheDocument();
  });
});
