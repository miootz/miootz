import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Loader2, XCircle } from "lucide-react";
import { joinMeetup, leaveMeetup, reserveMeetupSignup } from "../api/meetupsApi";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../context/ToastContext";
import { AppSplash } from "../components/AppSplash";

type ActionKind = "join" | "cancel" | "ignore" | "view" | "rate";

const ACTION_LABELS: Record<ActionKind, string> = {
  join: "Join meetup",
  cancel: "Leave meetup",
  ignore: "Ignore invite",
  view: "View meetup",
  rate: "Rate teammates",
};

export function MeetupReservationPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get("hold");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!token) return;
    const request = new AbortController();
    void reserveMeetupSignup(token, request.signal).then(({ meetup_id, hold_id }) => {
      if (!request.signal.aborted) {
        navigate(`/meetup-action?mid=${meetup_id}&act=join&reservation=${hold_id}`, { replace: true });
      }
    }).catch((error: unknown) => {
      if (!request.signal.aborted) {
        setFailure(error instanceof Error ? error.message : "Could not reserve your place.");
      }
    });
    return () => request.abort();
  }, [navigate, token]);

  if (!token || failure) {
    return (
      <main className="grid min-h-screen place-content-center gap-4 bg-board p-6 text-center">
        <p role="alert">{failure || "This notification link is no longer valid."}</p>
        <Link to="/" replace className="font-bold text-ink underline">Open meetup Overview</Link>
      </main>
    );
  }
  return <AppSplash status="Holding your place…" />;
}

export function MeetupActionPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loading: authLoading } = useAuth();
  const { showToast } = useToast();

  const meetupId = Number.parseInt(searchParams.get("mid") ?? "", 10);
  const action = (searchParams.get("act") ?? "view") as ActionKind;
  const reservation = searchParams.get("reservation");
  const reservationId = reservation === null ? undefined : Number(reservation);

  const [status, setStatus] = useState<
    "pending" | "authenticating" | "acting" | "done" | "error" | "reservation_expired"
  >("pending");
  const [message, setMessage] = useState("");

  const execute = useCallback(async (holdId?: number) => {
    if (Number.isNaN(meetupId)) {
      setStatus("error");
      setMessage("Invalid meetup link.");
      return;
    }

    setStatus("acting");
    try {
      if (action === "join") {
        const attendance = holdId === undefined ? await joinMeetup(meetupId) : await joinMeetup(meetupId, holdId);
        if (attendance.status === "reservation_expired") {
          setStatus("reservation_expired");
          setMessage("Your signup hold expired or belongs to another account. You can still join at the current position.");
          return;
        }
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
    void execute(reservationId);
  }, [authLoading, execute, reservationId]);

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
    ) : status === "error" || status === "reservation_expired" ? (
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
                : status === "reservation_expired" ? "Signup hold unavailable" : "Error"}
        </h1>
        <p className="text-sm text-ink-dim">{message}</p>
        {status === "reservation_expired" && (
          <button type="button" onClick={() => void execute()} className="bg-ink px-4 py-3 font-bold text-board">
            Join now
          </button>
        )}
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
