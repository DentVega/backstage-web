import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DriftBadge } from "@/app/components/DriftBadge";
import type { DriftStatus } from "@/lib/drift";

describe("DriftBadge", () => {
  const cases: Array<[DriftStatus, RegExp]> = [
    ["up_to_date", /Al día/],
    ["drift", /Actualización disponible/],
    ["untracked", /Sin sync/],
    ["unknown", /Desconocido/],
  ];
  for (const [status, label] of cases) {
    it(`renders the ${status} badge with an accessible label`, () => {
      render(<DriftBadge status={status} />);
      const el = screen.getByRole("status");
      expect(el).toHaveAttribute("aria-label", `Drift: ${status}`);
      expect(el).toHaveTextContent(label);
    });
  }
});
