import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Clock, XCircle } from "lucide-react";
import { joinSession, leaveSession } from "../api/sessionsApi";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../context/ToastContext";

type ActionKind = "join" | "cancel" | "ignore" | "view" | "rate";

const ACTION_LABELS: Record<ActionKind, string> = {
  join: "Join session",
  cancel: "Leave session",
  ignore: "Ignore invite",
  view: "View session",
  rate: "Rate teammates",
};

export function SessionActionPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loading: authLoading } = useAuth();
  const { showToast } = useToast();

  const sessionId = Number.parseInt(searchParams.get("sid") ?? "", 10);
  const action = (searchParams.get("act") ?? "view") as ActionKind;

  const [status, setStatus] = useState<
    "pending" | "authenticating" | "acting" | "done" | "error"
  >("pending");
  const [message, setMessage] = useState("");

  const execute = useCallback(async () => {
    if (Number.isNaN(sessionId)) {
      setStatus("error");
      setMessage("Invalid session link.");
      return;
    }

    setStatus("acting");
    try {
      if (action === "join") {
        const attendance = await joinSession(sessionId);
        setStatus("done");
        const joinedMessage = attendance.status === "waitlisted"
          ? "You're on the waitlist."
          : "You've joined the session!";
        setMessage(joinedMessage);
        showToast(joinedMessage, "success");
      } else if (action === "cancel") {
        await leaveSession(sessionId);
        setStatus("done");
        setMessage("You've left the session.");
        showToast("Left session", "success");
      } else if (action === "ignore") {
        setStatus("done");
        setMessage("Invite ignored.");
      } else if (action === "rate") {
        setStatus("done");
        setMessage("Opening ratings…");
      } else {
        setStatus("done");
        setMessage("Opening session…");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Action failed";
      // Reopening an invitation should lead to the existing signup.
      if (action === "join" && errMsg === "Already joined session") {
        setStatus("done");
        setMessage("You're already signed up. Opening the meetup…");
        return;
      }
      setStatus("error");
      setMessage(errMsg);
      showToast(errMsg, "error");
    }
  }, [sessionId, action, showToast]);

  // Execute action once auth resolves (RequireAuth guarantees `me` is set here)
  useEffect(() => {
    if (authLoading) {
      // One-shot status sync while auth resolves; guarded so it never cascades.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("authenticating");
      return;
    }
    void execute();
  }, [authLoading, execute]);

  // After action completes, navigate to the right page
  useEffect(() => {
    if (status !== "done") return;
    const timer = setTimeout(() => {
      if (action === "rate") {
        navigate("/?tab=history");
      } else {
        navigate(`/sessions/${sessionId}`);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [status, action, sessionId, navigate]);

  const icon =
    status === "done" ? (
      <Check className="h-16 w-16 text-emerald-500" />
    ) : status === "error" ? (
      <XCircle className="h-16 w-16 text-red-500" />
    ) : (
      <Clock className="h-16 w-16 text-violet-500 animate-spin" />
    );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg dark:border-gray-800 dark:bg-gray-900">
        <div className="flex justify-center">{icon}</div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {status === "authenticating"
            ? "Signing you in…"
            : status === "acting"
              ? (ACTION_LABELS[action] ?? "Processing…")
              : status === "done"
                ? "Done"
                : "Error"}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
        {status === "error" && (
          <button
            type="button"
            onClick={() => navigate("/sessions")}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            Go to sessions
          </button>
        )}
      </div>
    </div>
  );
}
