import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { AdminToolsPage } from "./AdminToolsPage";

const { fetchRatingSettings, saveRatingSettings } = vi.hoisted(() => ({
  fetchRatingSettings: vi.fn(),
  saveRatingSettings: vi.fn(),
}));
vi.mock("../../api/ratingSettingsApi", () => ({ fetchRatingSettings, saveRatingSettings }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

it("saves the selected rating and peer policies", async () => {
  fetchRatingSettings.mockResolvedValue({ computed_scores: true, peer_rating_mode: "everyone" });
  saveRatingSettings.mockImplementation(async (settings) => settings);
  render(<MemoryRouter><AdminToolsPage /></MemoryRouter>);
  const adjusted = await screen.findByRole("checkbox", { name: "Use adjusted ratings" });
  fireEvent.click(adjusted);
  fireEvent.click(screen.getByRole("radio", { name: "Teammates only" }));
  fireEvent.click(screen.getByRole("button", { name: "Save rating settings" }));
  await waitFor(() => expect(saveRatingSettings).toHaveBeenCalledWith({
    computed_scores: false, peer_rating_mode: "teammates-only",
  }));
  expect(await screen.findByText("Rating settings saved.")).toBeTruthy();
});
