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
    const seed = await screen.findByLabelText("Base Rating (0–5, optional)");
    expect(seed).toHaveValue(0);
    expect(screen.getByLabelText("Pace (PAC)")).toHaveValue(78.13);
    expect(screen.getByLabelText("Passing (PAS)")).toHaveValue(87.5);
    fireEvent.change(screen.getByLabelText("Passing (PAS)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Shooting (SHO)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Defending (DEF)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Dribbling (DRI)"), { target: { value: "93.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(adminUpdateUser).toHaveBeenCalledWith(1, {
      display_name: "Sam Vale", seed_skill: 0, dri: 4.5,
      sho_override: 1, pas_override: null, def_override: 5,
      primary_specialty: "DEF", secondary_specialty: null, is_admin: false,
    }));
  });
});
