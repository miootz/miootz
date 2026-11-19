import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProfilePage } from "./ProfilePage";
import { PUSH_REGISTRATION_CHANGED } from "../utils/pushSubscription";

const { fetchPushSubscriptions, subscribeToWebPush, deletePushSubscription, getRegistration, showToast } = vi.hoisted(() => ({
  fetchPushSubscriptions: vi.fn(),
  subscribeToWebPush: vi.fn(),
  deletePushSubscription: vi.fn(),
  getRegistration: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({
    me: { user: { id: 1, display_name: "Alex", pocket_id_sub: "alex" } },
    logout: vi.fn(),
    savePosition: vi.fn(),
  }),
}));
vi.mock("../auth/pocketIdOidc", () => ({ getPocketIdUrl: () => "https://auth.example.test" }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../api/meApi", () => ({
  fetchNotificationPreferences: vi.fn().mockResolvedValue({ items: [] }),
  fetchGameTemplateSubscriptions: vi.fn().mockResolvedValue({ items: [] }),
  fetchMyHistory: vi.fn().mockResolvedValue({ history: { items: [], total: 0 } }),
  fetchMyStats: vi.fn().mockRejectedValue(new Error("Stats unavailable")),
  patchGameTemplateSubscription: vi.fn(),
  patchNotificationPreference: vi.fn(),
}));
vi.mock("../utils/pushSubscription", async (importOriginal) => ({
  ...await importOriginal<typeof import("../utils/pushSubscription")>(),
  pushSupported: () => true,
  fetchPushSubscriptions,
  subscribeToWebPush,
  deletePushSubscription,
}));

const localEndpoint = "https://push.example.test/send/current-device";
const otherDevice = {
  id: 1,
  endpoint: "https://push.example.test/send/other-device",
  created_at: "2026-11-19T10:00:00Z",
};
const currentDevice = { ...otherDevice, id: 2, endpoint: localEndpoint };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PROD", true);
  vi.stubGlobal("navigator", Object.create(navigator, {
    serviceWorker: { value: { getRegistration } },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function openProfile() {
  render(<MemoryRouter><ProfilePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Push notifications" }));
}

it("finishes a local-only registration even when another device shares its push host", async () => {
  getRegistration.mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint: localEndpoint }) } });
  fetchPushSubscriptions
    .mockResolvedValueOnce([otherDevice])
    .mockResolvedValueOnce([otherDevice, currentDevice]);
  subscribeToWebPush.mockImplementation(async () => {
    window.dispatchEvent(new Event(PUSH_REGISTRATION_CHANGED));
    return { ok: true };
  });
  openProfile();

  const finish = await screen.findByRole("button", { name: "Finish registering this device" });
  fireEvent.click(finish);
  await waitFor(() => expect(subscribeToWebPush).toHaveBeenCalledOnce());
  expect(await screen.findByText("· This device")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Finish registering this device" })).not.toBeInTheDocument();
});

it("offers registration for a browser without a local subscription", async () => {
  getRegistration.mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } });
  fetchPushSubscriptions.mockResolvedValue([otherDevice]);
  openProfile();
  expect(await screen.findByRole("button", { name: "Register this device" })).toBeInTheDocument();
});

it("refreshes an open profile after registration from another part of the app", async () => {
  const getSubscription = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ endpoint: localEndpoint });
  getRegistration.mockResolvedValue({ pushManager: { getSubscription } });
  fetchPushSubscriptions.mockResolvedValueOnce([]).mockResolvedValueOnce([currentDevice]);
  openProfile();
  expect(await screen.findByRole("button", { name: "Register this device" })).toBeInTheDocument();

  act(() => window.dispatchEvent(new Event(PUSH_REGISTRATION_CHANGED)));

  expect(await screen.findByText("· This device")).toBeInTheDocument();
  expect(subscribeToWebPush).not.toHaveBeenCalled();
});

it("shows the current registered device and offers registration after its removal", async () => {
  getRegistration.mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint: localEndpoint }) } });
  fetchPushSubscriptions.mockResolvedValue([currentDevice]);
  deletePushSubscription.mockResolvedValue(undefined);
  openProfile();
  expect(await screen.findByText("· This device")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Register this device" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(await screen.findByRole("button", { name: "Finish registering this device" })).toBeInTheDocument();
  expect(deletePushSubscription).toHaveBeenCalledWith(currentDevice.id);
});

it("shows an error and retries when the server subscription list fails", async () => {
  getRegistration.mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint: localEndpoint }) } });
  fetchPushSubscriptions.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce([otherDevice]);
  openProfile();
  expect(await screen.findByText("Could not check notification registration. Connection lost")).toHaveAttribute("role", "alert");
  expect(screen.queryByText("No devices registered yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Finish registering this device" })).toBeInTheDocument();
});

it("shows the reason when registering a device fails", async () => {
  getRegistration.mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } });
  fetchPushSubscriptions.mockResolvedValue([]);
  subscribeToWebPush.mockRejectedValue(new Error("Network unavailable"));
  openProfile();
  fireEvent.click(await screen.findByRole("button", { name: "Register this device" }));
  expect(await screen.findByText("Network unavailable")).toHaveAttribute("role", "alert");
  expect(screen.getByRole("button", { name: "Register this device" })).toBeEnabled();
});
