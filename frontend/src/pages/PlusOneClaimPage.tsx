import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { UserPlus, CheckCircle, AlertCircle } from "lucide-react";
import {
  checkPlusOneClaim,
  claimPlusOne,
  type PlusOneClaimCheck,
} from "../api/sessionsApi";
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
    "w-full px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50";

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading reservation…
      </div>
    );
  }

  if (!guestInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <AlertCircle className="mx-auto text-red-500" size={40} />
          <h1 className="text-xl font-bold">Reservation unavailable</h1>
          <p className="text-sm" role="alert">
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
          <CheckCircle className="mx-auto text-emerald-500" size={48} />
          <h1 className="text-xl font-bold">
            {claimed ? "Your reservation is claimed" : "Already claimed"}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
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
      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-5 shadow-xl">
        <div className="flex items-center gap-3">
          <UserPlus
            className="text-violet-600 dark:text-violet-400 shrink-0"
            size={28}
          />
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Claim your reservation
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Invited by {guestInfo.inviter_display_name}
            </p>
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-4 space-y-2 text-sm">
          <p className="font-medium">
            {guestInfo.first_name} {guestInfo.last_name}
          </p>
          <p>Skill level: {guestInfo.self_assessed_skill}/5</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {SKILL_SCALE_BLURB}
          </p>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {me
            ? `Claim this reservation as ${me.user.display_name || "the signed-in member"}. Your existing profile stays with your account.`
            : "Sign in with your Miootz account to claim this reservation. If you do not have an account yet, ask the organizer for an account invitation first."}
        </p>
        {(error || authError) && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
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
