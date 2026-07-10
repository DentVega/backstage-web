import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateForm } from "@/app/components/CreateForm";

afterEach(() => vi.restoreAllMocks());

function fill() {
  fireEvent.change(screen.getByLabelText("id"), { target: { value: "payments" } });
  fireEvent.change(screen.getByLabelText("name"), { target: { value: "Payments" } });
  fireEvent.change(screen.getByLabelText("owner"), { target: { value: "acme" } });
}

describe("CreateForm", () => {
  it("submits and shows the created repo url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ repoUrl: "https://github.com/acme/miniapp-payments" }), {
          status: 201,
        }),
      ),
    );
    render(<CreateForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /crear miniapp/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("acme/miniapp-payments"),
    );
  });

  it("shows an error when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "ya existe" }), { status: 409 })),
    );
    render(<CreateForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /crear miniapp/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ya existe"));
  });

  it("blocks submit and flags an invalid id (no API call)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<CreateForm />);
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "Bad Id" } });
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("owner"), { target: { value: "o" } });
    expect(screen.getByLabelText("id")).toHaveAttribute("aria-invalid", "true");
    const btn = screen.getByRole("button", { name: /crear miniapp/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("links to the new miniapp's catalog detail on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ repoUrl: "https://github.com/acme/miniapp-payments" }), {
          status: 201,
        }),
      ),
    );
    render(<CreateForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /crear miniapp/i }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /ver en el catálogo/i })).toHaveAttribute(
        "href",
        "/miniapp/payments",
      ),
    );
  });
});
