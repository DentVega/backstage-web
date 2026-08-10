import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SyncAllControl } from "@/app/components/SyncAllControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("SyncAllControl", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dispatched: ["a", "b"], failed: [] }),
    }) as unknown as typeof fetch;
  });

  it("dispara y muestra el resultado", async () => {
    render(<SyncAllControl />);
    fireEvent.click(screen.getByRole("button", { name: /Actualizar toda la flota/ }));
    await waitFor(() => expect(screen.getByText(/2 disparadas/)).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/admin/sync-all", { method: "POST" });
  });
});
