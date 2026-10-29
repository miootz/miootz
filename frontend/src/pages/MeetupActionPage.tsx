import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Loader2, XCircle } from "lucide-react";
import { joinMeetup, leaveMeetup } from "../api/meetupsApi";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../context/ToastContext";

type ActionKind = "join" | "cancel" | "ignore" | "view" | "rate";

const ACTION_LABELS: Record<ActionKind, string> = {
  join: "Join meetup",
  cancel: "Leave meetup",
  ignore: "Ignore invite",
  view: "View meetup",
  rate: "Rate teammates",
};

export function MeetupActionPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loading: authLoading } = useAuth();
  const { showToast } = useToast();

  const meetupId = Number.parseInt(searchParams.get("mid") ?? "", 10);
  const action = (searchParams.get("act") ?? "view") as ActionKind;

  const [status, setStatus] = useState<
    "pending" | "authenticating" | "acting" | "done" | "error"
  >("pending");
  const [message, setMessage] = useState("");

  const execute = useCallback(async () => {
    if (Number.isNaN(meetupId)) {
      setStatus("error");
      setMessage("Invalid meetup link.");
      return;
    }

    setStatus("acting");
    try {
      if (action === "join") {
        const attendance = await joinMeetup(meetupId);
        setStatus("done");
        const joinedMessage = attendance.status === "waitlisted"
          ? "You're on the waitlist."
          : "You've joined the meetup!";
        setMessage(joinedMessage);
        showToast(joinedMessage, "success");
      } else if (action === "cancel") {
        await leaveMeetup(meetupId);
        setStatus("done");
        setMessage("You've left the meetup.");
        showToast("Left meetup", "success");
      } else if (action === "ignore") {
        setStatus("done");
        setMessage("Invite ignored.");
      } else if (action === "rate") {
        setStatus("done");
        setMessage("Opening ratings…");
      } else {
        setStatus("done");
        setMessage("Opening meetup…");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Action failed";
      // Reopening an invitation should lead to the existing signup.
      if (action === "join" && errMsg === "Already joined meetup") {
        setStatus("done");
        setMessage("You're already signed up. Opening the meetup…");
        return;
      }
      setStatus("error");
      setMessage(errMsg);
      showToast(errMsg, "error");
    }
  }, [meetupId, action, showToast]);

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
      // The member shell shows the next upcoming meetup (`/`) — ratings live
      // in History. Both are real routes; `/meetups/:id` is not.
      navigate(action === "rate" ? "/history" : "/");
    }, 1500);
    return () => clearTimeout(timer);
  }, [status, action, navigate]);

  const icon =
    status === "done" ? (
      <Check className="h-16 w-16 text-team-a" />
    ) : status === "error" ? (
      <XCircle className="h-16 w-16 text-danger" />
    ) : (
      <Loader2 className="h-16 w-16 animate-spin text-live" />
    );

  return (
    <div className="flex min-h-screen items-center justify-center bg-board p-6">
      <div className="w-full max-w-sm space-y-6 border border-line bg-panel p-8 text-center shadow-lg">
        <div className="flex justify-center">{icon}</div>
        <h1 className="text-xl font-bold text-ink">
          {status === "authenticating"
            ? "Signing you in…"
            : status === "acting"
              ? (ACTION_LABELS[action] ?? "Processing…")
              : status === "done"
                ? "Done"
                : "Error"}
        </h1>
        <p className="text-sm text-ink-dim">{message}</p>
        {status === "error" && (
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 bg-ink px-4 py-2.5 text-sm font-bold text-board hover:bg-white/90"
          >
            Go to meetup
          </button>
        )}
      </div>
    </div>
  );
}
