import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminAddAttendance, adminListUsers, adminRemoveAttendance } from "../api/adminApi";
import type { MeetupDetail } from "../api/meetupsApi";
import { MeetupAttendancePanel } from "./MeetupAttendancePanel";

vi.mock("../api/adminApi", () => ({
  adminAddAttendance: vi.fn(),
  adminListUsers: vi.fn(),
  adminMoveAttendance: vi.fn(),
  adminRemoveAttendance: vi.fn(),
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../utils/haptics", () => ({ hapticLight: vi.fn() }));

const player = (id: number, display_name: string) => ({
  id, display_name, username: null, avatar_url: null, calculated_skill: null,
  seed_skill: null, pac: null, dri: null, primary_specialty: null,
  secondary_specialty: null, is_admin: false, pocket_id_sub: null, has_pocket_id: false,
});
const detail = {
  attendees: [
    { user_id: 1, display_name: "Alex", status: "confirmed", skill: 3 },
    { user_id: 2, display_name: "Blair", status: "waitlisted", skill: 3 },
    { user_id: 3, display_name: "Casey", status: "cancelled", skill: 3 },
  ],
} as MeetupDetail;

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

function openPanel(onChanged = vi.fn()) {
  render(<MeetupAttendancePanel meetupId={7} detail={detail} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "Add player to attendance" }));
  return { onChanged, dialog: screen.getByRole("dialog", { name: "Add player" }) };
}

describe("Add attendance", () => {
  it("marks existing attendance and adds a new player once", async () => {
    vi.mocked(adminListUsers).mockResolvedValue({
      items: [player(1, "Alex"), player(2, "Blair"), player(3, "Casey"), player(4, "Drew")],
      total: 4,
    });
    vi.mocked(adminAddAttendance).mockResolvedValue({ status: "confirmed" });
    const { dialog, onChanged } = openPanel();
    await within(dialog).findByText("Drew");
    for (const [name, status] of [["Alex", "Confirmed"], ["Blair", "Waitlisted"], ["Casey", "Cancelled"]]) {
      const row = within(dialog).getByText(name).closest("li")!;
      expect(within(row).getByText(status)).toBeInTheDocument();
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Drew" }));
    await waitFor(() => expect(adminAddAttendance).toHaveBeenCalledWith(7, 4));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("status")).toHaveTextContent("Drew added as confirmed.");
    expect(within(dialog).queryByRole("button", { name: "Add Drew" })).not.toBeInTheDocument();
  });

  it("loads further pages and searches the player directory", async () => {
    vi.mocked(adminListUsers).mockImplementation(async ({ q, offset } = {}) => {
      if (q) return { items: [player(9, "Morgan")], total: 1 };
      return offset ? { items: [player(5, "Elliot")], total: 2 } : { items: [player(4, "Drew")], total: 2 };
    });
    const { dialog } = openPanel();
    await within(dialog).findByText("Drew");
    fireEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
    await within(dialog).findByText("Elliot");
    expect(adminListUsers).toHaveBeenCalledWith({ q: undefined, limit: 25, offset: 1 });
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search players" }), { target: { value: "Morgan" } });
    await within(dialog).findByText("Morgan");
    expect(adminListUsers).toHaveBeenCalledWith({ q: "Morgan", limit: 25, offset: 0 });
    expect(within(dialog).queryByText("Drew")).not.toBeInTheDocument();
  });

  it("waitlists a player and reports a stale-submit error", async () => {
    vi.mocked(adminListUsers).mockResolvedValue({ items: [player(4, "Drew")], total: 1 });
    vi.mocked(adminAddAttendance).mockRejectedValue(new Error("Player already has attendance for this meetup"));
    const { dialog, onChanged } = openPanel();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Add Drew" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("already has attendance");
    expect(adminAddAttendance).toHaveBeenCalledWith(7, 4);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("ignores old search results and closes on a native cancel request", async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof adminListUsers>>) => void;
    vi.mocked(adminListUsers).mockImplementation(({ q } = {}) => {
      if (q === "Drew") return new Promise((resolve) => { resolveOld = resolve; });
      return Promise.resolve({ items: q === "Morgan" ? [player(9, "Morgan")] : [], total: q === "Morgan" ? 1 : 0 });
    });
    const { dialog } = openPanel();
    const search = within(dialog).getByRole("searchbox", { name: "Search players" });
    fireEvent.change(search, { target: { value: "Drew" } });
    await waitFor(() => expect(adminListUsers).toHaveBeenCalledWith({ q: "Drew", limit: 25, offset: 0 }));
    fireEvent.change(search, { target: { value: "Morgan" } });
    await within(dialog).findByText("Morgan");
    await act(async () => resolveOld({ items: [player(4, "Drew")], total: 1 }));
    expect(within(dialog).queryByText("Drew")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Morgan")).toBeInTheDocument();
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "Add player" })).not.toBeInTheDocument();
  });
});

describe("Remove past attendance", () => {
  it("requires two confirmations before removing a player and refreshing", async () => {
    vi.mocked(adminRemoveAttendance).mockResolvedValue({ status: "deleted" });
    const onChanged = vi.fn();
    render(<MeetupAttendancePanel meetupId={7} detail={detail} onChanged={onChanged} isPast />);

    for (const name of ["Alex", "Blair", "Casey"]) {
      expect(screen.getByRole("button", { name: `Remove ${name}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Waitlist" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Alex" }));
    let dialog = screen.getByRole("dialog", { name: "Remove Alex?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(dialog).getByText(/assists on their goals/)).toHaveTextContent(/will not restore this data/);
    expect(within(dialog).getByText(/Recorded match results stay the same/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(adminRemoveAttendance).not.toHaveBeenCalled();
    dialog = screen.getByRole("dialog", { name: "Permanently remove Alex?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(adminRemoveAttendance).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove Alex" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Permanently remove" }));
    await waitFor(() => expect(adminRemoveAttendance).toHaveBeenCalledWith(7, 1));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(showToast).toHaveBeenCalledWith("Alex removed from attendance.", "success");
  });

  it("refreshes after a failed removal and explains how to retry", async () => {
    vi.mocked(adminRemoveAttendance).mockRejectedValue(new Error("Player not found."));
    const onChanged = vi.fn();
    render(<MeetupAttendancePanel meetupId={7} detail={detail} onChanged={onChanged} isPast />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Casey" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Permanently remove" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(showToast).toHaveBeenCalledWith("Player not found. Refresh attendance and try again.", "error");
  });

  it("keeps waitlist actions for upcoming attendance", () => {
    render(<MeetupAttendancePanel meetupId={7} detail={detail} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Waitlist" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove (Alex|Blair|Casey)/ })).not.toBeInTheDocument();
  });
});
