import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
	Check,
	ChevronRight,
	Copy,
	Loader2,
	Mail,
	Plus,
	Search,
	Users,
	XCircle,
} from "lucide-react";
import {
	adminCreateUser,
	adminListInvites,
	adminListUsers,
	type AdminInviteRow,
	type AdminUserRow,
} from "../../api/adminApi";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { PaginationControls } from "../../components/PaginationControls";
import { PlayerAvatarFace, SkillBadge } from "../../components/PlayerAvatar";
import { useToast } from "../../context/ToastContext";

const PAGE_SIZE = 25;

function skillOf(user: AdminUserRow): number | null {
	if (
		user.self_assessed_skill != null &&
		user.self_assessed_skill >= 1 &&
		user.self_assessed_skill <= 5
	) {
		return user.self_assessed_skill;
	}
	if (user.calculated_skill != null) {
		return Math.min(5, Math.max(1, Math.round(user.calculated_skill)));
	}
	return null;
}

function displayNameOf(user: AdminUserRow): string {
	return (
		user.display_name ||
		user.username ||
		user.pocket_id_sub?.slice(0, 8) ||
		`user-${user.id}`
	);
}

export function AdminPlayersPage() {
	const { showToast } = useToast();

	// --- Create player ---
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [userLoading, setUserLoading] = useState(false);
	const [userError, setUserError] = useState("");

	// --- Players list (server-side search + pagination) ---
	const [users, setUsers] = useState<AdminUserRow[]>([]);
	const [total, setTotal] = useState(0);
	const [usersLoading, setUsersLoading] = useState(true);
	const [userSearch, setUserSearch] = useState("");
	const [appliedQ, setAppliedQ] = useState("");
	const [page, setPage] = useState(1);

	// --- Invite history ---
	const [inviteHistory, setInviteHistory] = useState<AdminInviteRow[]>([]);
	const [inviteHistoryLoading, setInviteHistoryLoading] = useState(true);

	const loadInvites = useCallback(async () => {
		setInviteHistoryLoading(true);
		try {
			const rows = await adminListInvites();
			setInviteHistory(rows);
		} catch {
			setInviteHistory([]);
		} finally {
			setInviteHistoryLoading(false);
		}
	}, []);

	const loadUsers = useCallback(async (q: string, p: number) => {
		setUsersLoading(true);
		try {
			const r = await adminListUsers({
				q: q || undefined,
				limit: PAGE_SIZE,
				offset: (p - 1) * PAGE_SIZE,
			});
			setUsers(r.items);
			setTotal(r.total);
		} catch {
			setUsers([]);
			setTotal(0);
		} finally {
			setUsersLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadInvites();
	}, [loadInvites]);

	useEffect(() => {
		void loadUsers(appliedQ, page);
	}, [appliedQ, page, loadUsers]);

	// Debounce the search box; a new query always starts at page 1.
	useEffect(() => {
		const t = setTimeout(() => {
			const q = userSearch.trim();
			setAppliedQ(q);
			setPage(1);
		}, 300);
		return () => clearTimeout(t);
	}, [userSearch]);

	async function createPlayer() {
		const fn = firstName.trim();
		const ln = lastName.trim();
		if (!fn || !ln) {
			setUserError("Enter first name and last name.");
			return;
		}
		setUserError("");
		setUserLoading(true);
		try {
			await adminCreateUser({ first_name: fn, last_name: ln });
			setFirstName("");
			setLastName("");
			showToast("Player created.", "success");
			void loadUsers(appliedQ, page);
		} catch (err) {
			setUserError(err instanceof Error ? err.message : "Player creation failed");
		} finally {
			setUserLoading(false);
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

	return (
		<div className="p-2 sm:p-4 max-w-4xl mx-auto space-y-6">
			<AdminBreadcrumb
				items={[{ label: "Admin", to: "/admin" }, { label: "Players" }]}
			/>
			<AdminPageHeader title="Players" />

			{/* Create player form */}
			<section className="border border-line bg-panel p-4 sm:p-6 space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-ink flex items-center gap-2">
					<Plus className="h-4 w-4 sm:h-5 sm:w-5 text-team-a" aria-hidden />
					New player
				</h2>

				<div className="grid sm:grid-cols-2 gap-4">
					<div>
						<label
							htmlFor="firstName"
							className="block text-xs font-medium text-ink-dim mb-1"
						>
							First name
						</label>
						<input
							id="firstName"
							type="text"
							autoComplete="given-name"
							value={firstName}
							onChange={(e) => setFirstName(e.target.value)}
							placeholder="e.g. John"
							className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
						/>
					</div>
					<div>
						<label
							htmlFor="lastName"
							className="block text-xs font-medium text-ink-dim mb-1"
						>
							Last name
						</label>
						<input
							id="lastName"
							type="text"
							autoComplete="family-name"
							value={lastName}
							onChange={(e) => setLastName(e.target.value)}
							placeholder="e.g. Smith"
							className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
						/>
					</div>
				</div>

				{userError && (
					<p className="text-sm text-danger" role="alert">
						{userError}
					</p>
				)}

				<div className="flex gap-2">
					<button
						type="button"
						disabled={userLoading}
						onClick={() => void createPlayer()}
						className="inline-flex items-center gap-2 bg-ink text-board px-4 py-2.5 text-sm font-bold hover:bg-white/90 disabled:opacity-50 active:scale-[0.98] transition-colors"
					>
						{userLoading ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : null}
						Create player
					</button>
				</div>
			</section>

			{/* Players list */}
			<section className="border border-line bg-panel p-4 sm:p-6 space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-ink flex items-center gap-2">
					<Users className="h-4 w-4 sm:h-5 sm:w-5 text-team-a" aria-hidden />
					Roster
				</h2>

				<div className="flex items-center gap-3">
					<label className="flex min-w-0 flex-1 items-center gap-2 border border-line bg-raised px-3 py-2">
						<Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
						<input
							type="search"
							value={userSearch}
							onChange={(e) => setUserSearch(e.target.value)}
							placeholder="Search players…"
							className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-faint focus:outline-hidden"
							aria-label="Search players"
						/>
					</label>
					<span className="shrink-0 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint tabular-nums">
						{total} players
					</span>
				</div>

				{usersLoading ? (
					<div className="flex justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
					</div>
				) : users.length === 0 ? (
					<p className="text-sm text-ink-dim py-8 text-center">
						No players found.
					</p>
				) : (
					<>
						<div className="grid gap-3 md:grid-cols-2">
							{users.map((user) => {
								const displayName = displayNameOf(user);
								const skill = skillOf(user);
								return (
									<Link
										key={user.id}
										to={`/admin/players/${user.id}`}
										className="group flex items-center gap-3 border border-line bg-panel p-4 transition-colors hover:bg-raised"
										aria-label={`View ${displayName}`}
									>
										<PlayerAvatarFace
											name={displayName}
											avatarUrl={user.avatar_url ?? undefined}
											size="md"
										/>
										<span className="min-w-0 flex-1">
											<span className="flex items-center gap-2">
												<span className="min-w-0 truncate font-semibold text-ink text-sm">
													{displayName}
												</span>
												{skill != null && (
													<SkillBadge score={skill} size="sm" />
												)}
											</span>
											<span className="mt-1 flex flex-wrap items-center gap-2">
												{user.primary_specialty && (
													<span className="inline-flex items-center bg-team-b/15 px-2 py-0.5 text-xs font-medium text-team-b">
														{user.primary_specialty}
														{user.secondary_specialty && (
															<span className="text-team-b/70">
																{" "}
																/ {user.secondary_specialty}
															</span>
														)}
													</span>
												)}
												{user.is_admin && (
													<span className="inline-flex items-center bg-raised px-2 py-0.5 text-xs font-medium text-ink-dim">
														Admin
													</span>
												)}
												{user.has_pocket_id ? (
													<span className="inline-flex items-center bg-team-a/15 px-2 py-0.5 text-xs font-medium text-team-a">
														Pocket ID linked
													</span>
												) : (
													<span className="inline-flex items-center bg-raised px-2 py-0.5 text-xs font-medium text-ink-dim">
														Not linked
													</span>
												)}
											</span>
										</span>
										<ChevronRight
											className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink"
											aria-hidden
										/>
									</Link>
								);
							})}
						</div>
						<PaginationControls
							page={page}
							total={total}
							pageSize={PAGE_SIZE}
							onPage={setPage}
						/>
					</>
				)}
			</section>

			{/* Invite history */}
			<section className="border border-line bg-panel p-4 sm:p-6 space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-ink flex items-center gap-2">
					<Mail className="h-4 w-4 sm:h-5 sm:w-5 text-team-a" aria-hidden />
					Invite history
				</h2>

				{inviteHistoryLoading ? (
					<div className="flex justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
					</div>
				) : inviteHistory.length === 0 ? (
					<p className="text-sm text-ink-dim py-8 text-center">
						No invites created yet.
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-line text-left">
									<th className="pb-2 pr-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">Player</th>
									<th className="pb-2 pr-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint hidden sm:table-cell">Created</th>
									<th className="pb-2 pr-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint hidden sm:table-cell">Expires</th>
									<th className="pb-2 pr-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">Status</th>
									<th className="pb-2 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">Link</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-line">
								{inviteHistory.map((row) => {
									const expired = new Date(row.expires_at) < new Date();
									const name = `${row.first_name} ${row.last_name}`;
									return (
										<tr
											key={row.token}
											className="hover:bg-raised transition-colors"
										>
											<td className="py-2.5 pr-4 font-medium text-ink">
												{name}
											</td>
											<td className="py-2.5 pr-4 text-ink-faint tabular-nums hidden sm:table-cell">
												{new Date(row.created_at).toLocaleDateString()}
											</td>
											<td className="py-2.5 pr-4 text-ink-faint tabular-nums hidden sm:table-cell">
												{new Date(row.expires_at).toLocaleDateString()}
											</td>
											<td className="py-2.5 pr-4">
												{row.used ? (
													<span className="inline-flex items-center gap-1 text-xs font-medium text-team-a">
														<Check className="h-3.5 w-3.5" aria-hidden /> Used
													</span>
												) : expired ? (
													<span className="inline-flex items-center gap-1 text-xs font-medium text-ink-faint">
														<XCircle className="h-3.5 w-3.5" aria-hidden /> Expired
													</span>
												) : (
													<span className="inline-flex items-center gap-1 text-xs font-medium text-live">
														<Mail className="h-3.5 w-3.5" aria-hidden /> Active
													</span>
												)}
											</td>
											<td className="py-2.5">
												<button
													type="button"
													onClick={() => void copyLink(row.invite_link)}
													className="inline-flex items-center gap-1 border border-line px-2 py-1 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
												>
													<Copy className="h-3 w-3" aria-hidden />
													Copy
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
