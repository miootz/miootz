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
  const items = Array.from({ length: 11 }, (_, index) => ({
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

  const { container } = render(<MemoryRouter><AdminMeetupsPage /></MemoryRouter>);
  await screen.findByText("Pitch 11");
  const firstCard = () => container.querySelector('a[href^="/admin/meetups/"]:not([href$="/new"])');
  expect(fetchMeetups).toHaveBeenCalledWith(expect.objectContaining({ order: "desc", offset: 0 }));
  expect(firstCard()).toHaveTextContent("Pitch 11");

  fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "10" } });
  await waitFor(() => expect(fetchMeetups).toHaveBeenCalledWith(expect.objectContaining({ order: "desc", offset: 0, limit: 10 })));
  await waitFor(() => expect(screen.queryByText("Pitch 1")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByText("Pitch 1");
  expect(fetchMeetups).toHaveBeenCalledWith(expect.objectContaining({ order: "desc", offset: 10 }));

  const sort = screen.getByRole("combobox", { name: "Sort meetups by date" });
  sort.focus();
  fireEvent.change(sort, { target: { value: "asc" } });
  await waitFor(() => expect(firstCard()).toHaveTextContent("Pitch 1"));
  expect(sort).toHaveFocus();
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("oldest first"));

  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByText("Pitch 11");
  expect(fetchMeetups).toHaveBeenCalledWith(expect.objectContaining({ order: "asc", offset: 10 }));
});
