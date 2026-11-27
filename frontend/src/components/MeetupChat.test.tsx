import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiFetch } from "../api/client";
import { MeetupChat } from "./MeetupChat";

vi.mock("../api/client", () => ({ apiFetch: vi.fn() }));
vi.mock("../api/meetupsApi", () => ({ meetupChatEventsUrl: () => "/events" }));
vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ me: { user: { id: 1 } }, tokens: { accessToken: "test" } }),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../stores/meetupChatCache", () => ({
  getCachedChatMessages: async () => undefined,
  setCachedChatMessages: async () => {},
  appendCachedChatMessage: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("acknowledges delivery in a background tab and marks read only in the foreground", async () => {
  let intersect: (visible: boolean) => void = () => {};
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = (isIntersecting) => callback(
        [{ isIntersecting }] as IntersectionObserverEntry[],
        this as unknown as IntersectionObserver,
      );
    }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("EventSource", class { close() {} });
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path.endsWith("/receipt")) return Response.json({});
    if (path.endsWith("/receipts")) return Response.json({});
    return Response.json([
      { id: 8, user_id: 2, username: "Alex", message: "See you there", created_at: "2026-11-27T18:00:00Z" },
    ]);
  });
  render(<MeetupChat meetupId="42" standalone />);
  await screen.findByText("See you there");
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    "/meetups/42/chat/receipt", expect.objectContaining({ body: '{"delivered_id":8}' }),
  ));
  act(() => intersect(true));
  expect(apiFetch).not.toHaveBeenCalledWith(
    "/meetups/42/chat/receipt", expect.objectContaining({ body: '{"delivered_id":8,"read_id":8}' }),
  );
  focus.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    "/meetups/42/chat/receipt", expect.objectContaining({ body: '{"delivered_id":8,"read_id":8}' }),
  ));
});
