import React, { useEffect, useState } from "react";
import {
	CheckCircle2,
	Hourglass,
	MapPin,
	PartyPopper,
	Share,
	Trophy,
	Shield,
	Users,
	XCircle,
	type LucideIcon,
} from "lucide-react";
import type { Meetup } from "../types";
import { TeamLineups } from "../components/TeamLineups";
import { MatchHistoryList } from "../components/MatchHistoryList";
import { MeetupChat } from "../components/MeetupChat";
import { MeetupLocationSection } from "../components/MeetupLocationSection";
import { LiveMatchBanner } from "../components/LiveMatchBanner";
import { PitchPicker } from "../components/PitchPicker";
import { fetchMeetupMatches, type MatchSummary } from "../api/matchesApi";
import { SuccessCheckLottie } from "../components/SuccessCheckLottie";
import {
	addPlusOne,
	joinMeetup,
	leaveMeetup,
	redeemWeatherHero,
} from "../api/meetupsApi";
import { CloudRain } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../auth/useAuth";
import { Link } from "react-router-dom";
import { hapticError, hapticSuccess } from "../utils/haptics";
import { parseMeetupStart } from "../utils/datetime";
import { shareLink } from "../utils/share";
import { UserPlus } from "lucide-react";
import { MobileSheet } from "../components/MobileSheet";
import { StarRating } from "../components/StarRating";
import { SKILL_SCALE_BLURB } from "../components/OnboardingCard";
import { roomPath } from "../utils/demoRoom";

interface MeetupDetailsProps {
	meetup: Meetup;
	onRosterUpdated?: () => void;
	/** Server-sent events channel open - roster updates apply in real time. */
	rosterChannelLive?: boolean;
	/** Last time attendance/teams were loaded from the server. */
	lastRosterSync?: Date | null;
	/** When this meetup was loaded from IndexedDB while offline. */
	offlineDataUpdatedAt?: Date | null;
}

function PlusOneModal({
	meetupId,
	onClose,
	onSuccess,
}: {
	meetupId: string;
	onClose: () => void;
	onSuccess: () => void;
}) {
	const { showToast } = useToast();
	const formId = React.useId();
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [skill, setSkill] = useState<number | null>(5);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<{ claim_url: string } | null>(null);
	const sid = Number.parseInt(meetupId, 10);

	const handleSharePlusOne = async () => {
		if (!result) return;
		const url = `${window.location.origin}${roomPath(result.claim_url)}`;
		const success = await shareLink(
			url,
			"Miootz Plus-One",
			"Check out this Miootz plus-one invite!",
		);
		if (success) {
			showToast("Invite link shared!", "success");
		} else {
			showToast("Failed to share invite.", "error");
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!firstName.trim() || !lastName.trim()) {
			setError("Please fill in both names.");
			return;
		}
		if (skill == null) {
			setError("Choose a skill level.");
			return;
		}
		setBusy(true);
		try {
			const res = await addPlusOne(sid, {
				first_name: firstName.trim(),
				last_name: lastName.trim(),
				skill: skill,
			});
			setResult({ claim_url: res.claim_url });
			hapticSuccess();
			showToast(
				`Plus-one added for ${res.first_name} ${res.last_name}!`,
				"success",
			);
			onSuccess();
		} catch (e) {
			hapticError();
			const msg = e instanceof Error ? e.message : "Failed to add plus-one";
			setError(msg);
			showToast(msg, "error");
		} finally {
			setBusy(false);
		}
	};

	return (
		<MobileSheet
			onClose={onClose}
			title={result ? "Plus-one added!" : "Add a plus-one"}
			footer={
				result ? (
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleSharePlusOne}
							className="flex min-h-12 flex-1 items-center justify-center gap-2 border border-line px-4 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink"
						>
							<Share className="h-4 w-4" aria-hidden />
							Share
						</button>
						<button
							type="button"
							onClick={onClose}
							className="min-h-12 flex-1 bg-ink px-4 py-2.5 text-sm font-bold text-board hover:bg-white/90"
						>
							Done
						</button>
					</div>
				) : (
					<div className="flex gap-2">
						<button
							type="button"
							onClick={onClose}
							className="min-h-12 flex-1 border border-line px-4 py-2 text-sm text-ink-dim hover:bg-raised"
						>
							Cancel
						</button>
						<button
							type="submit"
							form={formId}
							disabled={busy}
							className="min-h-12 flex-1 bg-ink px-4 py-2.5 text-sm font-bold text-board hover:bg-white/90 disabled:opacity-50"
						>
							{busy ? "Adding…" : "Add plus-one"}
						</button>
					</div>
				)
			}
		>
			{result ? (
				<div className="space-y-4 text-center">
					<PartyPopper className="mx-auto h-10 w-10 text-team-a" aria-hidden />
					<div className="break-all bg-raised p-3 text-xs font-mono text-ink-dim select-all">
						{window.location.origin}
						{roomPath(result.claim_url)}
					</div>
				</div>
			) : (
				<form id={formId} onSubmit={handleSubmit} className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label htmlFor="plus-one-first" className="mb-1 block text-xs font-medium text-ink-dim">
								First name
							</label>
							<input
								id="plus-one-first"
								type="text"
								value={firstName}
								onChange={(e) => setFirstName(e.target.value)}
								placeholder="John"
								className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live"
								maxLength={80}
							/>
						</div>
						<div>
							<label htmlFor="plus-one-last" className="mb-1 block text-xs font-medium text-ink-dim">
								Last name
							</label>
							<input
								id="plus-one-last"
								type="text"
								value={lastName}
								onChange={(e) => setLastName(e.target.value)}
								placeholder="Doe"
								className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live"
								maxLength={80}
							/>
						</div>
					</div>

					<div>
						<span className="mb-1 block text-xs font-medium text-ink-dim">Skill level</span>
						<StarRating value={skill} onChange={setSkill} onClear={() => setSkill(null)} min={1} size={28} label="Skill level" />
						<p className="mt-1 text-2xs text-ink-faint">
							{SKILL_SCALE_BLURB}
						</p>
					</div>

					{error && (
						<p className="text-sm text-danger" role="alert">
							{error}
						</p>
					)}
				</form>
			)}
		</MobileSheet>
	);
}

/** Attendance status → hero tile + copy. Amber is reserved for "now/you". */
const STATUS_META: Record<
	string,
	{ icon: LucideIcon; tile: string; heading: string; sub: string }
> = {
	confirmed: {
		icon: CheckCircle2,
		tile: "bg-team-a/15 text-team-a",
		heading: "You're confirmed",
		sub: "See you there.",
	},
	waitlisted: {
		icon: Hourglass,
		tile: "bg-live/15 text-live",
		heading: "You're on the waitlist",
		sub: "We'll let you know if a spot opens.",
	},
	cancelled: {
		icon: XCircle,
		tile: "bg-raised text-ink-faint",
		heading: "You're not attending",
		sub: "You can join again anytime.",
	},
	none: {
		icon: UserPlus,
		tile: "bg-raised text-ink-dim",
		heading: "Not signed up yet",
		sub: "Tap Join to claim your spot.",
	},
};

function MeetupAttendanceActions({
	meetupId,
	myAttendance,
	onUpdated,
	myWaitlistPosition,
	myWeatherHeroUnused,
}: {
	meetupId: string;
	myAttendance: Meetup["myAttendance"];
	onUpdated: () => void;
	myWaitlistPosition?: number | null;
	myWeatherHeroUnused?: number | null;
}) {
	const { showToast } = useToast();
	const [busy, setBusy] = useState(false);
	const [feedback, setFeedback] = useState<string | null>(null);
	const [opt, setOpt] = useState<Meetup["myAttendance"] | undefined>();
	const [celebrate, setCelebrate] = useState(false);
	const [showPlusOne, setShowPlusOne] = useState(false);
	const sid = Number.parseInt(meetupId, 10);

	const status = opt !== undefined ? opt : myAttendance;

	useEffect(() => {
		setOpt(undefined);
	}, [myAttendance]);

	const runJoin = async () => {
		setFeedback(null);
		setBusy(true);
		setOpt("confirmed");
		try {
			const res = await joinMeetup(sid);
			const next = res.status === "waitlisted" ? "waitlisted" : "confirmed";
			setOpt(next);
			hapticSuccess();
			setCelebrate(true);
			window.setTimeout(() => setCelebrate(false), 2200);
			showToast(
				next === "waitlisted"
					? `You're on the waitlist.`
					: `You're on the list for this meetup.`,
				"success",
			);
			onUpdated();
		} catch (e) {
			setOpt(undefined);
			hapticError();
			const msg = e instanceof Error ? e.message : "Request failed";
			setFeedback(msg);
			showToast(msg, "error");
		} finally {
			setBusy(false);
		}
	};

	const runLeave = async () => {
		setFeedback(null);
		setBusy(true);
		const wasWait = status === "waitlisted";
		setOpt(null);
		try {
			await leaveMeetup(sid);
			hapticSuccess();
			showToast(
				wasWait ? `You've left the waitlist.` : `You've left this meetup.`,
				"success",
			);
			onUpdated();
		} catch (e) {
			setOpt(undefined);
			hapticError();
			const msg = e instanceof Error ? e.message : "Request failed";
			setFeedback(msg);
			showToast(msg, "error");
		} finally {
			setBusy(false);
		}
	};

	const runRedeemWeatherHero = async () => {
		setFeedback(null);
		setBusy(true);
		try {
			const res = await redeemWeatherHero(sid);
			setOpt(res.status === "confirmed" ? "confirmed" : status);
			hapticSuccess();
			setCelebrate(true);
			window.setTimeout(() => setCelebrate(false), 2200);
			showToast("Weather Hero used — you're on the list!", "success");
			onUpdated();
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Request failed";
			setFeedback(msg);
			showToast(msg, "error");
		} finally {
			setBusy(false);
		}
	};

	const meta = STATUS_META[status ?? "none"];
	const MetaIcon = meta.icon;

	return (
		<div className="relative max-w-xl mx-auto">
			{celebrate && (
				<div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/90">
					<SuccessCheckLottie size={100} />
				</div>
			)}
			<div className="bg-panel border border-line overflow-hidden">
				<div className="flex items-center gap-4 p-4">
					<div
						className={`w-14 h-14 flex-shrink-0 flex items-center justify-center rounded-xl ${meta.tile}`}
						aria-hidden
					>
						<MetaIcon size={28} strokeWidth={2.25} />
					</div>
					<div className="min-w-0">
						<h2 className="text-base font-bold leading-tight text-ink">
							{meta.heading}
						</h2>
						<p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-dim">
							{status === "waitlisted" && myWaitlistPosition != null && (
								<span className="inline-flex items-center bg-live/15 px-2 py-0.5 text-xs font-medium tabular-nums text-live">
									#{myWaitlistPosition} on waitlist
								</span>
							)}
							{meta.sub}
						</p>
					</div>
				</div>
			<div className="border-t border-line px-4 py-3">
				{feedback && (
					<p className="mb-2 text-sm text-danger" role="alert">
						{feedback}
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					{(status == null || status === "cancelled") && (
						<button
							type="button"
							disabled={busy}
							onClick={() => void runJoin()}
							className="flex-1 min-w-[10rem] justify-center px-4 py-2.5 inline-flex items-center bg-ink text-board text-sm font-bold hover:bg-white/90 disabled:opacity-50 active:scale-[0.98]"
						>
							{status === "cancelled" ? "Join again" : "Join meetup"}
						</button>
					)}
					{status === "waitlisted" && (myWeatherHeroUnused ?? 0) > 0 && (
						<button
							type="button"
							disabled={busy}
							onClick={() => void runRedeemWeatherHero()}
							className="inline-flex flex-1 min-w-[10rem] justify-center items-center gap-1.5 px-4 py-2.5 bg-live text-board text-sm font-bold hover:bg-live/90 disabled:opacity-50 active:scale-[0.98]"
						>
							<CloudRain size={14} aria-hidden />
							Use Weather Hero spot
						</button>
					)}
					{(status === "confirmed" || status === "waitlisted") && (
						<>
							{status === "confirmed" && (
								<button
									type="button"
									onClick={() => setShowPlusOne(true)}
									className="inline-flex flex-1 min-w-[10rem] justify-center items-center gap-1.5 px-4 py-2 border border-line text-sm text-ink-dim hover:bg-raised hover:text-ink active:scale-[0.98]"
								>
									<UserPlus size={14} />
									Add a plus-one
								</button>
							)}
							<button
								type="button"
								disabled={busy}
								onClick={() => void runLeave()}
								className="inline-flex flex-1 min-w-[10rem] justify-center items-center px-4 py-2 border border-danger/40 text-sm text-danger hover:bg-danger/10 disabled:opacity-50 active:scale-[0.98]"
							>
								{status === "confirmed" ? "Leave meetup" : "Leave waitlist"}
							</button>
						</>
					)}
				</div>
			</div>
			</div>
			{showPlusOne && (
				<PlusOneModal
					meetupId={meetupId}
					onClose={() => setShowPlusOne(false)}
					onSuccess={() => {
						setShowPlusOne(false);
						onUpdated();
					}}
				/>
			)}
		</div>
	);
}

function LiveMatchBoard({ meetupId }: { meetupId: number }) {
	const [matches, setMatches] = useState<MatchSummary[]>([]);
	useEffect(() => {
		let cancelled = false;
		void fetchMeetupMatches(meetupId)
			.then((res) => {
				if (!cancelled) setMatches(res.matches);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [meetupId]);
	const inProgress = matches.filter(
		(m) => m.status !== "completed",
	);
	return (
		<>
			<PitchPicker meetupId={meetupId} />
			{inProgress.map((m) => (
				<LiveMatchBanner key={m.id} meetupId={meetupId} matchId={m.id} />
			))}
		</>
	);
}

export const MeetupDetails: React.FC<MeetupDetailsProps> = ({
	meetup,
	onRosterUpdated,
	lastRosterSync,
}) => {
	const { me } = useAuth();
	const meetupIdNum = Number.parseInt(meetup.id, 10);

	// Slow tick — only the T-15 min boundary flip depends on it.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const iv = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(iv);
	}, []);

	// From 15 minutes before kickoff the overview is about the match:
	// results take the attendance card's place and teams go away.
	// (PlayerApp keeps this meetup home until the next signup opens.)
	const startMs = meetup.startTime ? parseMeetupStart(meetup.startTime).getTime() : NaN;
	const resultsMode =
		Number.isFinite(startMs) && now >= startMs - 15 * 60_000;

	return (
		<div className={`p-4 sm:p-6 max-w-6xl mx-auto space-y-8 pb-8 desktop:grid desktop:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] desktop:items-start desktop:gap-8 desktop:space-y-0 ${
			resultsMode ? "tablet:grid tablet:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)] tablet:items-start tablet:gap-6 tablet:space-y-0" : ""
		}`}>
			<div className="min-w-0 space-y-8">
				{/* 1. Match results — from T-15 min, in place of attendance */}
				{resultsMode && !isNaN(meetupIdNum) && (
					<section className="space-y-3">
						<h2 className="text-lg font-bold text-ink flex items-center gap-2">
							<Trophy className="h-5 w-5 text-ink-dim" aria-hidden />
							Matches
							{me?.is_admin && (
								<Link
									to={`/meetup-matches/${meetupIdNum}`}
									className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-line text-ink-dim hover:bg-raised hover:text-ink"
								>
									<Shield size={13} />
									Referee
								</Link>
							)}
						</h2>
						<LiveMatchBoard meetupId={meetupIdNum} />
						<MatchHistoryList
							meetupId={meetupIdNum}
							editable
							allowCreate={false}
							refreshKey={lastRosterSync?.getTime()}
							attendees={meetup.attendance.map((player) => ({
								user_id: Number(player.id),
								display_name: player.name,
								avatar_url: player.avatarUrl ?? null,
								status: player.attendanceStatus ?? "confirmed",
								joined_at: null,
								skill: player.skillScore,
							}))}
						/>
					</section>
				)}

				{/* 2. Join / Leave / Plus-one — before T-15 min only */}
				{!resultsMode && onRosterUpdated && (
					<MeetupAttendanceActions
						meetupId={meetup.id}
						myAttendance={meetup.myAttendance}
						myWaitlistPosition={meetup.myWaitlistPosition}
						myWeatherHeroUnused={meetup.myWeatherHeroUnused}
						onUpdated={onRosterUpdated}
					/>
				)}

				{/* 3. Teams — before T-15 min only */}
				{!resultsMode && (
					<section className="space-y-3">
						<h2 className="text-lg font-bold text-ink flex items-center gap-2">
							<Users className="h-5 w-5 text-ink-dim" aria-hidden />
							Teams
						</h2>
						<TeamLineups
							meetup={meetup}
							linkToPlayers={me?.is_admin === true}
							currentUserId={me ? String(me.user.id) : undefined}
						/>
					</section>
				)}
			</div>
			<div className={`min-w-0 space-y-8 desktop:border-l desktop:border-line desktop:ps-6 ${
				resultsMode ? "tablet:border-l tablet:border-line tablet:ps-4" : ""
			}`}>
				{/* 4. Chat */}
				<hr className={`border-line desktop:hidden ${resultsMode ? "tablet:hidden" : ""}`} />
				<MeetupChat meetupId={meetup.id} />

				{/* 5. Location */}
				<>
					<hr className="border-line" />
					<h2 className="text-lg font-bold text-ink flex items-center gap-2">
						<MapPin className="h-5 w-5 text-ink-dim" aria-hidden />
						Location
					</h2>
				</>
				<MeetupLocationSection
					location={meetup.location}
					latitude={meetup.latitude}
					longitude={meetup.longitude}
				/>
			</div>
		</div>
	);
};
