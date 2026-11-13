import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
	CheckCircle2,
	Copy,
	Hourglass,
	Loader2,
	Mail,
	Share,
	Trash2,
	XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
	adminDeleteUser,
	adminGenerateInvite,
	adminGetPlayerHistory,
	adminUpdateUser,
	type AdminUserUpdate,
	type PlayerHistory,
	type PlayerHistoryRow,
} from "../../api/adminApi";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { PaginationControls } from "../../components/PaginationControls";
import { PlayerAvatarFace, SkillBadge } from "../../components/PlayerAvatar";
import { StarRating } from "../../components/StarRating";
import { useToast } from "../../context/ToastContext";
import { shareLink } from "../../utils/share";

const HISTORY_PAGE_SIZE = 25;

const SPECIALTIES = ["ATT", "MID", "DEF", "GK"] as const;

const STATUS_META: Record<
	PlayerHistoryRow["status"],
	{ icon: ReactNode; label: string; className: string }
> = {
	confirmed: {
		icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
		label: "Confirmed",
		className: "text-team-a",
	},
	waitlisted: {
		icon: <Hourglass className="h-4 w-4" aria-hidden />,
		label: "Waitlisted",
		className: "text-live",
	},
	cancelled: {
		icon: <XCircle className="h-4 w-4" aria-hidden />,
		label: "Cancelled",
		className: "text-ink-faint",
	},
};

function StatBlock({ label, value }: { label: string; value: string }) {
	return (
		<div className="border border-line bg-raised p-4">
			<p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
				{label}
			</p>
			<p className="mt-2 text-3xl font-extrabold tabular-nums text-ink">
				{value}
			</p>
		</div>
	);
}

export function AdminPlayerDetailPage() {
	const { showToast } = useToast();
	const navigate = useNavigate();
	const { userId } = useParams<{ userId: string }>();
	const id = userId ? parseInt(userId, 10) : NaN;

	const [data, setData] = useState<PlayerHistory | null>(null);
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);
	const [historyPage, setHistoryPage] = useState(1);

	// Profile form (mirrors the loaded row)
	const [editDisplayName, setEditDisplayName] = useState("");
	const [editSkill, setEditSkill] = useState(0);
	const [editPrimary, setEditPrimary] = useState("");
	const [editSecondary, setEditSecondary] = useState("");
	const [editIsAdmin, setEditIsAdmin] = useState(false);
	const [saving, setSaving] = useState(false);

	// Invite
	const [inviting, setInviting] = useState(false);
	const [inviteResult, setInviteResult] = useState<{
		invite_link: string;
		expires_at: string;
	} | null>(null);

	const load = useCallback(
		async (page: number) => {
			if (Number.isNaN(id)) return;
			try {
				const r = await adminGetPlayerHistory(id, {
					limit: HISTORY_PAGE_SIZE,
					offset: (page - 1) * HISTORY_PAGE_SIZE,
				});
				setData(r);
				setNotFound(false);
				setEditDisplayName(r.user.display_name || "");
				setEditSkill(r.user.calculated_skill != null ? Math.min(5, Math.max(1, r.user.calculated_skill)) : 0);
				setEditPrimary(r.user.primary_specialty || "");
				setEditSecondary(r.user.secondary_specialty || "");
				setEditIsAdmin(r.user.is_admin);
			} catch (e) {
				if (
					e instanceof Error &&
					/404|not found/i.test(e.message)
				) {
					setNotFound(true);
				}
				setData(null);
			} finally {
				setLoading(false);
			}
		},
		[id],
	);

	useEffect(() => {
		setLoading(true);
		setHistoryPage(1);
		void load(1);
	}, [load]);

	async function saveProfile() {
		setSaving(true);
		try {
			const body: AdminUserUpdate = {};
			body.display_name = editDisplayName.trim() || null;
			body.calculated_skill = editSkill > 0 ? editSkill : null;
			body.primary_specialty =
				(editPrimary as AdminUserUpdate["primary_specialty"]) || null;
			body.secondary_specialty =
				(editSecondary as AdminUserUpdate["secondary_specialty"]) || null;
			body.is_admin = editIsAdmin;
			await adminUpdateUser(id, body);
			showToast("Player updated.", "success");
			await load(historyPage);
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Update failed", "error");
		} finally {
			setSaving(false);
		}
	}

	async function generateInvite() {
		setInviting(true);
		setInviteResult(null);
		try {
			const r = await adminGenerateInvite(id);
			setInviteResult(r);
			showToast("Invite link generated.", "success");
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Invite generation failed",
				"error",
			);
		} finally {
			setInviting(false);
		}
	}

	async function copyLink(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			showToast("Copied to clipboard.", "success");
		} catch {
			/* ignore */
		}
	}

	async function shareInvite(url: string) {
		const ok = await shareLink(
			url,
			"Miootz Invite",
			"Check out this Miootz invite!",
		);
		showToast(ok ? "Invite link shared!" : "Failed to share invite.", ok ? "success" : "error");
	}

	async function deletePlayer() {
		const name = data?.user
			? data.user.display_name ||
			  data.user.username ||
			  `user-${data.user.id}`
			: `user-${id}`;
		if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
		try {
			await adminDeleteUser(id);
			showToast("Player deleted.", "success");
			navigate("/admin/players");
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Delete failed", "error");
		}
	}

	if (loading) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
			</div>
		);
	}

	if (notFound || !data) {
		return (
			<div className="p-2 sm:p-4 max-w-4xl mx-auto space-y-6">
				<AdminBreadcrumb
					items={[
						{ label: "Admin", to: "/admin" },
						{ label: "Players", to: "/admin/players" },
						{ label: "Not found" },
					]}
				/>
				<p className="text-sm text-ink-dim py-8 text-center">
					Player not found.{" "}
					<Link to="/admin/players" className="text-live hover:underline">
						Back to players
					</Link>
				</p>
			</div>
		);
	}

	const user = data.user;
	const displayName =
		user.display_name ||
		user.username ||
		user.pocket_id_sub?.slice(0, 8) ||
		`user-${user.id}`;
	const handle = user.username ? `@${user.username}` : "";
	const stats = data.stats;
	const history = data.history;
	const historyItems = history.items;

	return (
		<div className="p-2 sm:p-4 max-w-4xl mx-auto space-y-6">
			<AdminBreadcrumb
				items={[
					{ label: "Admin", to: "/admin" },
					{ label: "Players", to: "/admin/players" },
					{ label: displayName },
				]}
			/>

			{/* Header */}
			<header className="border border-line bg-panel p-4 sm:p-6 flex items-center gap-4">
				<PlayerAvatarFace
					name={displayName}
					avatarUrl={user.avatar_url ?? undefined}
					size="lg"
				/>
				<div className="min-w-0 flex-1">
					<h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-ink tracking-tight">
						<span className="min-w-0 truncate">{displayName}</span>
						{user.calculated_skill != null && (
							<SkillBadge
								score={Math.min(5, Math.max(1, Math.round(user.calculated_skill)))}
								size="md"
							/>
						)}
					</h1>
					{handle && (
						<p className="mt-0.5 text-sm text-ink-faint truncate">
							{handle}
						</p>
					)}
				</div>
				{user.is_admin && (
					<span className="shrink-0 inline-flex items-center bg-raised px-2 py-1 text-xs font-medium text-ink-dim">
						Admin
					</span>
				)}
			</header>

			{/* Stats */}
			<section className="space-y-3">
				<h2 className="text-base sm:text-lg font-semibold text-ink">
					Stats
				</h2>
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<StatBlock label="Games played" value={String(stats.games_played)} />
					<StatBlock label="This season" value={String(stats.season_games)} />
					<StatBlock
						label="Avg rating"
						value={stats.average_rating.toFixed(1)}
					/>
					<StatBlock
						label="Skill level"
						value={
							stats.skill_level > 0
								? stats.skill_level.toFixed(1)
								: "—"
						}
					/>
				</div>
			</section>

			{/* Profile */}
			<section className="border border-line bg-panel p-4 sm:p-6 space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-ink">
					Profile
				</h2>

				<div>
					<label
						htmlFor="player-display-name"
						className="block text-xs font-medium text-ink-dim mb-1"
					>
						Display name
					</label>
					<input
						id="player-display-name"
						type="text"
						value={editDisplayName}
						onChange={(e) => setEditDisplayName(e.target.value)}
						placeholder="e.g. John Smith"
						className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live"
					/>
				</div>

				<div>
					<span className="block text-xs font-medium text-ink-dim mb-1.5">
						Skill
					</span>
					<StarRating
						value={editSkill}
						onChange={(v) => setEditSkill(v)}
						size={28}
						label="Skill rating"
						halfSteps
					/>
				</div>

				<div className="grid sm:grid-cols-2 gap-4">
					<div>
						<label
							htmlFor="player-primary"
							className="block text-xs font-medium text-ink-dim mb-1"
						>
							Primary position
						</label>
						<select
							id="player-primary"
							value={editPrimary}
							onChange={(e) => setEditPrimary(e.target.value)}
							className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
						>
							<option value="">— unset —</option>
							{SPECIALTIES.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					</div>
					<div>
						<label
							htmlFor="player-secondary"
							className="block text-xs font-medium text-ink-dim mb-1"
						>
							Secondary position
						</label>
						<select
							id="player-secondary"
							value={editSecondary}
							onChange={(e) => setEditSecondary(e.target.value)}
							className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
						>
							<option value="">— unset —</option>
							{SPECIALTIES.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					</div>
				</div>

				<div className="flex items-center justify-between gap-3 flex-wrap">
					<label className="inline-flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={editIsAdmin}
							onChange={(e) => setEditIsAdmin(e.target.checked)}
							className="border-line text-team-a focus:ring-2 focus:ring-live"
						/>
						<span className="text-sm text-ink">Admin</span>
					</label>
					<button
						type="button"
						disabled={saving}
						onClick={() => void saveProfile()}
						className="inline-flex items-center gap-2 bg-ink text-board px-4 py-2.5 text-sm font-bold hover:bg-white/90 disabled:opacity-50 active:scale-[0.98] transition-colors"
					>
						{saving ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : null}
						Save
					</button>
				</div>
			</section>

			{/* Access */}
			<section className="border border-line bg-panel p-4 sm:p-6 space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-ink">
					Access
				</h2>

				{user.has_pocket_id ? (
					<p className="flex items-center gap-2 text-sm font-medium text-team-a">
						<CheckCircle2 className="h-4 w-4" aria-hidden />
						Pocket ID linked
					</p>
				) : (
					<div className="space-y-4">
						<p className="flex items-center gap-2 text-sm text-ink-dim">
							<XCircle className="h-4 w-4 text-ink-faint" aria-hidden />
							Not linked — generate an invite link to give this player a
							Pocket ID passkey.
						</p>
						<button
							type="button"
							disabled={inviting}
							onClick={() => void generateInvite()}
							className="inline-flex items-center gap-2 border border-team-a/40 px-4 py-2.5 text-sm font-medium text-team-a hover:bg-team-a/15 disabled:opacity-50 active:scale-[0.98] transition-colors"
						>
							{inviting ? (
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
							) : (
								<Mail className="h-4 w-4" aria-hidden />
							)}
							Invite to Pocket ID
						</button>

						{inviteResult && (
							<div className="border border-team-a/40 bg-team-a/15 p-4 space-y-3">
								<p className="text-sm font-medium text-ink">
									Invite ready — share this link or QR code:
								</p>
								<div className="flex flex-wrap items-center gap-3">
									<input
										readOnly
										value={inviteResult.invite_link}
										className="min-w-0 flex-1 border border-line bg-raised px-3 py-1.5 text-xs font-mono text-ink transition-colors"
										onClick={(e) =>
											(e.target as HTMLInputElement).select()
										}
									/>
									<button
										type="button"
										onClick={() => void shareInvite(inviteResult.invite_link)}
										className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
									>
										<Share className="h-3.5 w-3.5" aria-hidden />
										Share
									</button>
									<button
										type="button"
										onClick={() => void copyLink(inviteResult.invite_link)}
										className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
									>
										<Copy className="h-3.5 w-3.5" aria-hidden />
										Copy
									</button>
								</div>
								<div className="flex items-center gap-3">
									<QRCodeSVG
										value={inviteResult.invite_link}
										size={120}
										level="M"
									/>
								</div>
							</div>
						)}
					</div>
				)}

				<div className="border-t border-line pt-4">
					<button
						type="button"
						onClick={() => void deletePlayer()}
						className="inline-flex items-center gap-2 border border-danger/40 px-4 py-2.5 text-sm font-medium text-danger hover:bg-danger/10 active:scale-[0.98] transition-colors"
					>
						<Trash2 className="h-4 w-4" aria-hidden />
						Delete player
					</button>
				</div>
			</section>

			{/* Attendance history */}
			<section className="border border-line bg-panel p-4 sm:p-6 space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-ink">
					Attendance history
				</h2>

				{historyItems.length === 0 ? (
					<p className="text-sm text-ink-dim py-8 text-center">
						No meetups yet.
					</p>
				) : (
					<>
						{/* Desktop table */}
						<div className="hidden sm:block overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b border-line text-left">
										<th className="pb-2 pr-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">Date</th>
										<th className="pb-2 pr-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">Meetup</th>
										<th className="pb-2 pr-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">Status</th>
										<th className="pb-2 pr-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">Score</th>
										<th className="pb-2 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">Rating</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-line">
									{historyItems.map((row) => {
										const meta = STATUS_META[row.status];
										return (
											<tr
												key={row.meetup_id}
												className="hover:bg-raised transition-colors"
											>
												<td className="py-2.5 pr-4 text-ink-faint tabular-nums whitespace-nowrap">
													{new Date(row.start_time).toLocaleDateString()}
												</td>
												<td className="py-2.5 pr-4 font-medium text-ink">
													{row.location}
												</td>
												<td className="py-2.5 pr-4">
													<span
														className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.className}`}
													>
														{meta.icon}
														{meta.label}
													</span>
												</td>
												<td className="py-2.5 pr-4 text-ink-dim tabular-nums whitespace-nowrap">
													{row.score_team != null &&
														`T ${row.score_team}`}
													{row.score_team != null &&
														row.score_individual != null &&
														" · "}
													{row.score_individual != null &&
														`I ${row.score_individual}`}
													{row.score_team == null &&
														row.score_individual == null &&
														"—"}
												</td>
												<td className="py-2.5 text-ink-dim tabular-nums">
													{row.rating_avg != null
														? row.rating_avg.toFixed(1)
														: "—"}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>

						{/* Mobile stacked rows */}
						<div className="sm:hidden divide-y divide-line">
							{historyItems.map((row) => {
								const meta = STATUS_META[row.status];
								return (
									<div key={row.meetup_id} className="py-3">
										<div className="flex items-baseline justify-between gap-3">
											<p className="min-w-0 truncate font-medium text-ink text-sm">
												{row.location}
											</p>
											<p className="shrink-0 text-xs text-ink-faint tabular-nums">
												{new Date(row.start_time).toLocaleDateString()}
											</p>
										</div>
										<div className="mt-1.5 flex items-center gap-3">
											<span
												className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.className}`}
											>
												{meta.icon}
												{meta.label}
											</span>
											<span className="ml-auto text-xs text-ink-dim tabular-nums">
												{row.score_team != null && `T ${row.score_team}`}
												{row.score_team != null &&
													row.score_individual != null &&
													" · "}
												{row.score_individual != null && `I ${row.score_individual}`}
												{row.rating_avg != null &&
													` · ★ ${row.rating_avg.toFixed(1)}`}
											</span>
										</div>
									</div>
								);
							})}
						</div>

						<PaginationControls
							page={historyPage}
							total={history.total}
							pageSize={HISTORY_PAGE_SIZE}
							onPage={setHistoryPage}
						/>
					</>
				)}
			</section>
		</div>
	);
}
