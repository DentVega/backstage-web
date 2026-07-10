import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserMenu } from "@/app/components/UserMenu";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

describe("UserMenu", () => {
  it("renders the user and a sign-out button when signed in", () => {
    render(<UserMenu user={{ name: "Ada", image: null }} />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
  it("renders nothing when signed out", () => {
    const { container } = render(<UserMenu user={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
