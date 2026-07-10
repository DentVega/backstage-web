import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CiBadge } from "@/app/components/CiBadge";
import type { CiStatus } from "@/lib/ci";

describe("CiBadge", () => {
  const cases: Array<[CiStatus, RegExp]> = [
    ["success", /OK/],
    ["failure", /Fallo/],
    ["in_progress", /En curso/],
    ["none", /Sin runs/],
    ["unknown", /Desconocido/],
  ];
  for (const [status, label] of cases) {
    it(`renders the ${status} badge with an accessible label`, () => {
      render(<CiBadge status={status} />);
      const el = screen.getByRole("status");
      expect(el).toHaveAttribute("aria-label", `CI: ${status}`);
      expect(el).toHaveTextContent(label);
    });
  }
});
