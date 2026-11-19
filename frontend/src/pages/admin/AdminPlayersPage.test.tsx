import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { AdminPlayersPage } from "./AdminPlayersPage";

const { adminCreateUser, adminListInvites, adminListUsers } = vi.hoisted(() => ({
  adminCreateUser: vi.fn(), adminListInvites: vi.fn(), adminListUsers: vi.fn(),
}));
vi.mock("../../api/adminApi", () => ({ adminCreateUser, adminListInvites, adminListUsers }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

it("creates players with an unset or half-star base rating", async () => {
  adminListInvites.mockResolvedValue([]);
  adminListUsers.mockResolvedValue({ items: [], total: 0 });
  adminCreateUser.mockResolvedValue({});
  render(<MemoryRouter><AdminPlayersPage /></MemoryRouter>);

  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Alex" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Vale" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear Base Rating" }));
  fireEvent.click(screen.getByRole("button", { name: "Create player" }));
  await waitFor(() => expect(adminCreateUser).toHaveBeenCalledWith({
    first_name: "Alex", last_name: "Vale", calculated_skill: null,
  }));

  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sam" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Hill" } });
  fireEvent.change(screen.getByRole("slider", { name: "Base Rating" }), { target: { value: "2.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Create player" }));
  await waitFor(() => expect(adminCreateUser).toHaveBeenLastCalledWith({
    first_name: "Sam", last_name: "Hill", calculated_skill: 2.5,
  }));
});
