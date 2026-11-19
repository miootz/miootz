import { beforeEach, expect, it, vi } from "vitest";
import { adminSendTestPush } from "./adminApi";
import { apiFetch } from "./client";

vi.mock("./client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./client")>(),
  apiFetch: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it("sends a bodyless test request and returns per-device results", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ sent: 1, failed: 2, expired: 3 }));
  await expect(adminSendTestPush()).resolves.toEqual({ sent: 1, failed: 2, expired: 3 });
  expect(apiFetch).toHaveBeenCalledWith("/users/me/push/test", { method: "POST" });
});

it.each([403, 503])("reports a server error when sending a test returns %s", async (status) => {
  vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ detail: "Test notification unavailable" }, { status }));
  await expect(adminSendTestPush()).rejects.toThrow("Test notification unavailable");
});
