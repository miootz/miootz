import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { fetchMeetups } from "../../api/meetupsApi";
import { AdminMeetupsPage } from "./AdminMeetupsPage";

vi.mock("../../api/meetupsApi", () => ({ fetchMeetups: vi.fn() }));
vi.mock("../../api/adminApi", () => ({ adminDeleteMeetup: vi.fn() }));
vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

it("loads newest meetups first and applies the selected order across pages", async () => {
  const items = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    start_time: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
    location: `Pitch ${index + 1}`,
    fee: 0,
    latitude: null,
    longitude: null,
    content_revision: 0,
    min_players: 10,
    max_players: 15,
    confirmed_count: 10,
    waitlist_mode: "auto_promote",
  }));
  vi.mocked(fetchMeetups).mockImplementation(async (options) => {
    const ordered = options?.order === "desc" ? [...items].reverse() : items;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? ordered.length;
    return { items: ordered.slice(offset, offset + limit), offset, limit, total: items.length };
  });

  render(<MemoryRouter><AdminMeetupsPage /></MemoryRouter>);
  const newest = await screen.findByRole("link", { name: /Pitch 60/ });
  expect(fetchMeetups).toHaveBeenCalledWith(expect.objectContaining({ order: "desc", offset: 0 }));
  expect(screen.getAllByRole("link", { name: /Pitch \d+/ })[0]).toBe(newest);

  fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "50" } });
  await waitFor(() => expect(fetchMeetups).toHaveBeenCalledWith(expect.objectContaining({ order: "desc", offset: 0, limit: 50 })));
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByRole("link", { name: /Pitch 10/ });
  expect(fetchMeetups).toHaveBeenCalledWith(expect.objectContaining({ order: "desc", offset: 50 }));

  const sort = screen.getByRole("combobox", { name: "Sort meetups by date" });
  sort.focus();
  fireEvent.change(sort, { target: { value: "asc" } });
  await screen.findByRole("link", { name: /Pitch 1\b/ });
  expect(sort).toHaveFocus();
  expect(screen.getAllByRole("link", { name: /Pitch \d+/ })[0]).toHaveTextContent("Pitch 1");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("oldest first"));

  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByRole("link", { name: /Pitch 51/ });
  expect(fetchMeetups).toHaveBeenCalledWith(expect.objectContaining({ order: "asc", offset: 50 }));
});
