import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { AdminToolsPage } from "./AdminToolsPage";

const { fetchRatingSettings, saveRatingSettings, adminSendTestPush } = vi.hoisted(() => ({
  fetchRatingSettings: vi.fn(),
  saveRatingSettings: vi.fn(),
  adminSendTestPush: vi.fn(),
}));
vi.mock("../../api/ratingSettingsApi", () => ({ fetchRatingSettings, saveRatingSettings }));
vi.mock("../../api/adminApi", () => ({ adminRunRecurringNow: vi.fn(), adminExportData: vi.fn(), adminSendTestPush }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

it("saves the selected rating and peer policies", async () => {
  fetchRatingSettings.mockResolvedValue({ computed_scores: true, peer_rating_mode: "everyone" });
  saveRatingSettings.mockImplementation(async (settings) => settings);
  render(<MemoryRouter><AdminToolsPage /></MemoryRouter>);
  const adjusted = await screen.findByRole("switch", { name: "Use adjusted ratings" });
  fireEvent.click(adjusted);
  fireEvent.click(screen.getByRole("radio", { name: "Teammates only" }));
  fireEvent.click(screen.getByRole("button", { name: "Save rating settings" }));
  await waitFor(() => expect(saveRatingSettings).toHaveBeenCalledWith({
    computed_scores: false, peer_rating_mode: "teammates-only",
  }));
  expect(await screen.findByText("Rating settings saved.")).toBeTruthy();
});

it("sends one test notification and displays the delivery counts", async () => {
  fetchRatingSettings.mockResolvedValue({ computed_scores: true, peer_rating_mode: "everyone" });
  let finish!: (result: { sent: number; failed: number; expired: number }) => void;
  adminSendTestPush.mockReset().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<MemoryRouter><AdminToolsPage /></MemoryRouter>);
  const button = screen.getByRole("button", { name: "Send a test push notification to myself" });
  fireEvent.click(button);
  expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  expect(adminSendTestPush).toHaveBeenCalledOnce();
  finish({ sent: 1, failed: 2, expired: 3 });
  expect(await screen.findByText("Sent: 1 · Failed: 2 · Expired: 3")).toHaveAttribute("role", "status");
  expect(screen.getByRole("button", { name: "Send a test push notification to myself" })).toBeEnabled();
});

it("shows the server error when a test notification fails", async () => {
  fetchRatingSettings.mockResolvedValue({ computed_scores: true, peer_rating_mode: "everyone" });
  adminSendTestPush.mockReset().mockRejectedValue(new Error("Server has not configured Web Push"));
  render(<MemoryRouter><AdminToolsPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Send a test push notification to myself" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Server has not configured Web Push");
});

it("explains how to register when there are no devices", async () => {
  fetchRatingSettings.mockResolvedValue({ computed_scores: true, peer_rating_mode: "everyone" });
  adminSendTestPush.mockReset().mockResolvedValue({ sent: 0, failed: 0, expired: 0 });
  render(<MemoryRouter><AdminToolsPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Send a test push notification to myself" }));
  expect(await screen.findByText("No devices registered. Register this device in your profile.")).toHaveAttribute("role", "status");
});
