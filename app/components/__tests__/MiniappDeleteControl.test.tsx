import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MiniappDeleteControl } from "@/app/components/MiniappDeleteControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("MiniappDeleteControl", () => {
  it("el botón se habilita solo al tipear el id exacto", () => {
    render(<MiniappDeleteControl id="cards_wallet" hasRepo={true} />);
    const btn = screen.getByRole("button", { name: /Eliminar/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirmar id de la miniapp"), {
      target: { value: "cards_wallet" },
    });
    expect(btn).toBeEnabled();
  });
  it("el checkbox de repo se muestra solo si hasRepo", () => {
    const { rerender } = render(<MiniappDeleteControl id="x" hasRepo={false} />);
    expect(screen.queryByLabelText(/borrar el repositorio/i)).toBeNull();
    rerender(<MiniappDeleteControl id="x" hasRepo={true} />);
    expect(screen.getByLabelText(/borrar el repositorio/i)).toBeInTheDocument();
  });
});
