import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPlayerDetailPage } from "./AdminPlayerDetailPage";

const { adminGetPlayerHistory, adminUpdateUser } = vi.hoisted(() => ({
  adminGetPlayerHistory: vi.fn(), adminUpdateUser: vi.fn(),
}));

vi.mock("../../api/adminApi", () => ({
  adminGetPlayerHistory, adminUpdateUser,
  adminDeleteUser: vi.fn(), adminGenerateInvite: vi.fn(),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

describe("AdminPlayerDetailPage", () => {
  beforeEach(() => {
    adminGetPlayerHistory.mockReset().mockResolvedValue({
      user: {
        id: 1, display_name: "Sam Vale", username: null, avatar_url: null,
        calculated_skill: 3.8, seed_skill: 0, pac: 3.25, dri: null, pas_override: 4,
        primary_specialty: "DEF", secondary_specialty: null,
        is_admin: false, pocket_id_sub: null, has_pocket_id: true,
      },
      stats: { games_played: 0, season_games: 0, average_rating: 0, total_ratings: 0, skill_level: 3.8 },
      history: { items: [], total: 0 },
    });
    adminUpdateUser.mockReset().mockResolvedValue({ message: "updated" });
  });

  it("preserves a zero seed and sends nullable attributes without overwriting the overall rating", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/players/1"]}>
        <Routes><Route path="/admin/players/:userId" element={<AdminPlayerDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    const seed = await screen.findByRole("slider", { name: "Base Rating (0–5, optional)" });
    expect(seed).toHaveAttribute("aria-valuetext", "0 out of 5 stars");
    expect(screen.getByLabelText("Pace (PAC)")).toHaveValue(78);
    expect(screen.getByLabelText("Dribbling (DRI)")).toHaveAttribute("placeholder", "75 (default)");
    expect(screen.getByLabelText("Passing (PAS)")).toHaveValue(88);
    fireEvent.change(screen.getByLabelText("Passing (PAS)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Shooting (SHO)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Defending (DEF)"), { target: { value: "100" } });
    const dribbling = screen.getByLabelText("Dribbling (DRI)");
    fireEvent.change(dribbling, { target: { value: "93.75" } });
    expect(dribbling).toBeInvalid();
    fireEvent.change(dribbling, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(adminUpdateUser).toHaveBeenCalledWith(1, {
      display_name: "Sam Vale", seed_skill: 0, dri: 4.2,
      sho_override: 1, pas_override: null, def_override: 5,
      primary_specialty: "DEF", secondary_specialty: null, is_admin: false,
    }));
  });

  it("clears a legacy zero base rating to unset", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/players/1"]}>
        <Routes><Route path="/admin/players/:userId" element={<AdminPlayerDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Clear Base Rating (0–5, optional)" }));
    expect(screen.getByRole("slider", { name: "Base Rating (0–5, optional)" }))
      .toHaveAttribute("aria-valuetext", "Not rated");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(adminUpdateUser).toHaveBeenCalledWith(1, expect.objectContaining({ seed_skill: null })));
  });

  it("preserves an existing non-half-star base rating until it is edited", async () => {
    const data = await adminGetPlayerHistory();
    data.user.seed_skill = 3.3;
    render(
      <MemoryRouter initialEntries={["/admin/players/1"]}>
        <Routes><Route path="/admin/players/:userId" element={<AdminPlayerDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("slider", { name: "Base Rating (0–5, optional)" }))
      .toHaveAttribute("aria-valuetext", "3.3 out of 5 stars");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(adminUpdateUser).toHaveBeenCalledWith(1, expect.objectContaining({ seed_skill: 3.3 })));
  });
});
