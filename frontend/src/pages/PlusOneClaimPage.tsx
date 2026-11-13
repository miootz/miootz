import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { UserPlus, CheckCircle, AlertCircle } from "lucide-react";
import {
  checkPlusOneClaim,
  claimPlusOne,
  type PlusOneClaimCheck,
} from "../api/meetupsApi";
import { useAuth } from "../auth/useAuth";
import { SKILL_SCALE_BLURB } from "../components/OnboardingCard";
import { useToast } from "../context/ToastContext";
import { hapticError, hapticSuccess } from "../utils/haptics";

export function PlusOneClaimPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { me, loading: authLoading, login, error: authError } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guestInfo, setGuestInfo] = useState<PlusOneClaimCheck | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setClaimed(false);
    setGuestInfo(null);
    setError(null);
    if (!token) {
      setError("No claim token provided.");
      setLoading(false);
      return;
    }
    void checkPlusOneClaim(token)
      .then((data) => {
        if (active) setGuestInfo(data);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Invalid claim link");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function signIn() {
    sessionStorage.setItem("miootz_return_path", window.location.pathname);
    await login();
  }

  async function handleClaim() {
    if (!token || !me || busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await claimPlusOne(token);
      hapticSuccess();
      showToast(
        `${result.display_name}, your reservation is linked to your account.`,
        "success",
      );
      setClaimed(true);
    } catch (e) {
      hapticError();
      setError(e instanceof Error ? e.message : "Failed to claim");
    } finally {
      setBusy(false);
    }
  }

  let claimButtonLabel = "Sign in to claim";
  if (me) claimButtonLabel = "Claim my reservation";
  if (busy) claimButtonLabel = "Claiming…";

  const buttonClass =
    "w-full px-4 py-2.5 bg-ink text-board text-sm font-bold hover:bg-white/90 disabled:opacity-50";

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-board flex items-center justify-center text-ink-dim">
        Loading reservation…
      </div>
    );
  }

  if (!guestInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <AlertCircle className="mx-auto text-danger" size={40} />
          <h1 className="text-xl font-bold text-ink">Reservation unavailable</h1>
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
          <button className={buttonClass} onClick={() => navigate("/")}>
            Go home
          </button>
        </div>
      </div>
    );
  }

  if (claimed || guestInfo.status === "claimed") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <CheckCircle className="mx-auto text-team-a" size={48} />
          <h1 className="text-xl font-bold text-ink">
            {claimed ? "Your reservation is claimed" : "Already claimed"}
          </h1>
          <p className="text-sm text-ink-dim">
            {claimed
              ? "Your place or waitlist position is now linked to your account."
              : "This reservation has already been linked to a member account."}
          </p>
          <button className={buttonClass} onClick={() => navigate("/")}>
            Open Miootz
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-line bg-panel p-6 space-y-5 shadow-xl">
        <div className="flex items-center gap-3">
          <UserPlus
            className="text-ink shrink-0"
            size={28}
          />
          <div>
            <h1 className="text-xl font-bold text-ink">
              Claim your reservation
            </h1>
            <p className="text-sm text-ink-dim">
              Invited by {guestInfo.inviter_display_name}
            </p>
          </div>
        </div>
        <div className="bg-raised p-4 space-y-2 text-sm text-ink">
          <p className="font-medium">
            {guestInfo.first_name} {guestInfo.last_name}
          </p>
          <p className="tabular-nums">Skill level: {guestInfo.skill}/5</p>
          <p className="text-xs text-ink-dim">
            {SKILL_SCALE_BLURB}
          </p>
        </div>
        {!me && (
          <p className="text-sm text-ink-dim">
            If you do not have an account yet, ask the organizer for an
            account invitation first.
          </p>
        )}
        {(error || authError) && (
          <p className="text-sm text-danger" role="alert">
            {error || authError}
          </p>
        )}
        <button
          className={buttonClass}
          disabled={busy}
          onClick={() => void (me ? handleClaim() : signIn())}
        >
          {claimButtonLabel}
        </button>
      </div>
    </div>
  );
}
