import { expect, it, vi } from "vitest";
import { apiFetch } from "./client";
import { finishPenaltyShootout, undoPenaltyShot } from "./matchesApi";

vi.mock("./client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./client")>(),
  apiFetch: vi.fn(),
}));

it.each([
  { action: "finish", request: finishPenaltyShootout, response: { winner: "a" } },
  { action: "undo", request: undoPenaltyShot, response: { shots: [] } },
])("sends a bodyless POST to $action a penalty shootout", async ({ action, request, response }) => {
  vi.mocked(apiFetch).mockResolvedValueOnce(Response.json(response));

  await expect(request(3, 9)).resolves.toEqual(response);
  expect(apiFetch).toHaveBeenLastCalledWith(`/meetups/3/matches/9/penalty/${action}`, {
    method: "POST",
    body: undefined,
  });
});
