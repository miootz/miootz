import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Check,
	Copy,
	Loader2,
	Mail,
	Pencil,
	Plus,
	Search,
	Share,
	Trash2,
	Users,
	X,
	XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
	adminCreateUser,
	adminDeleteUser,
	adminGenerateInvite,
	adminListInvites,
	adminListUsers,
	adminUpdateUser,
	type AdminInviteRow,
	type AdminUserRow,
	type AdminUserUpdate,
} from "../../api/adminApi";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { PlayerAvatarFace, SkillBadge } from "../../components/PlayerAvatar";
import { StarRating } from "../../components/StarRating";
import { useToast } from "../../context/ToastContext";
import { shareLink } from "../../utils/share";

const SPECIALTIES = ["ATT", "MID", "DEF", "GK"] as const;

export function AdminUsersPage() {
	const { showToast } = useToast();

	// --- User creation state ---
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [userLoading, setUserLoading] = useState(false);
	const [userError, setUserError] = useState("");

	// --- Invite generation state ---
	const [invitingUserId, setInvitingUserId] = useState<number | null>(null);
	const [inviteResult, setInviteResult] = useState<{
		invite_link: string;
		expires_at: string;
		userId: number;
	} | null>(null);

	// --- Invite history ---
	const [inviteHistory, setInviteHistory] = useState<AdminInviteRow[]>([]);
	const [inviteHistoryLoading, setInviteHistoryLoading] = useState(true);

	// --- Users ---
	const [users, setUsers] = useState<AdminUserRow[]>([]);
	const [usersLoading, setUsersLoading] = useState(true);
	const [userSearch, setUserSearch] = useState("");
	const [editingUserId, setEditingUserId] = useState<number | null>(null);
	const [savingUserId, setSavingUserId] = useState<number | null>(null);

	// Edit form state (mirrors a single user row)
	const [editDisplayName, setEditDisplayName] = useState("");
	const [editSkill, setEditSkill] = useState<number>(0);
	const [editPrimary, setEditPrimary] = useState("");
	const [editSecondary, setEditSecondary] = useState("");
	const [editIsAdmin, setEditIsAdmin] = useState(false);

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

	const loadUsers = useCallback(async () => {
		setUsersLoading(true);
		try {
			const rows = await adminListUsers();
			setUsers(rows);
		} catch {
			setUsers([]);
		} finally {
			setUsersLoading(false);
		}
	}, []);

	useEffect(() => {
		void Promise.all([loadInvites(), loadUsers()]);
	}, [loadInvites, loadUsers]);

	// --- Create user ---
	async function createUser() {
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
			showToast("User created.", "success");
			void loadUsers();
		} catch (err) {
			setUserError(err instanceof Error ? err.message : "User creation failed");
		} finally {
			setUserLoading(false);
		}
	}

	// --- Generate invite ---
	async function generateInvite(user: AdminUserRow) {
		setInvitingUserId(user.id);
		setInviteResult(null);
		try {
			const r = await adminGenerateInvite(user.id);
			setInviteResult({ ...r, userId: user.id });
			showToast("Invite link generated.", "success");
			void loadInvites();
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Invite generation failed",
				"error",
			);
		} finally {
			setInvitingUserId(null);
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

	async function shareLinkInvite(url: string) {
		const success = await shareLink(
			url,
			"Miootz Invite",
			"Check out this Miootz invite!",
		);
		if (success) {
			showToast("Invite link shared!", "success");
		} else {
			showToast("Failed to share invite.", "error");
		}
	}

	// --- User editing ---
	const filteredUsers = useMemo(() => {
		const q = userSearch.trim().toLowerCase();
		if (!q) return users;
		return users.filter((u) => {
			const name = (u.display_name || "").toLowerCase();
			const uname = (u.username || "").toLowerCase();
			const sub = (u.pocket_id_sub || "").toLowerCase();
			return name.includes(q) || uname.includes(q) || sub.includes(q);
		});
	}, [users, userSearch]);

	function startEdit(user: AdminUserRow) {
		setEditingUserId(user.id);
		setEditDisplayName(user.display_name || "");
		setEditSkill(user.self_assessed_skill ?? 0);
		setEditPrimary(user.primary_specialty || "");
		setEditSecondary(user.secondary_specialty || "");
		setEditIsAdmin(user.is_admin);
	}

	function cancelEdit() {
		setEditingUserId(null);
	}

	async function saveEdit(user: AdminUserRow) {
		setSavingUserId(user.id);
		try {
			const body: AdminUserUpdate = {};
			body.display_name = editDisplayName.trim() || null;
			body.self_assessed_skill = editSkill > 0 ? editSkill : null;
			body.primary_specialty =
				(editPrimary as AdminUserUpdate["primary_specialty"]) || null;
			body.secondary_specialty =
				(editSecondary as AdminUserUpdate["secondary_specialty"]) || null;
			body.is_admin = editIsAdmin;
			await adminUpdateUser(user.id, body);
			showToast("User updated.", "success");
			setEditingUserId(null);
			void loadUsers();
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Update failed", "error");
		} finally {
			setSavingUserId(null);
		}
	}

	async function deleteUser(user: AdminUserRow) {
		const name = user.display_name || user.username || `user-${user.id}`;
		if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
		try {
			await adminDeleteUser(user.id);
			showToast("User deleted.", "success");
			setEditingUserId(null);
			void loadUsers();
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Delete failed", "error");
		}
	}

	return (
		<div className="p-2 sm:p-4 max-w-2xl mx-auto space-y-6">
			<AdminBreadcrumb
				items={[{ label: "Admin", to: "/admin" }, { label: "Users" }]}
			/>
			<AdminPageHeader
				title="Users"
				subtitle="Manage players, edit profiles, and generate invite links."
			/>

			{/* Create user form */}
			<section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-6 shadow-sm space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
					<Plus className="h-4 w-4 sm:h-5 sm:w-5 text-violet-600" aria-hidden />
					New user
				</h2>

				<div className="grid sm:grid-cols-2 gap-4">
					<div>
						<label
							htmlFor="firstName"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
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
							className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:text-white transition-colors"
						/>
					</div>
					<div>
						<label
							htmlFor="lastName"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
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
							className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:text-white transition-colors"
						/>
					</div>
				</div>

				{userError && (
					<p className="text-sm text-red-600 dark:text-red-400" role="alert">
						{userError}
					</p>
				)}

				<div className="flex gap-2">
					<button
						type="button"
						disabled={userLoading}
						onClick={() => void createUser()}
						className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98] transition-colors"
					>
						{userLoading ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : null}
						Create user
					</button>
				</div>
			</section>

			{/* Users list */}
			<section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-6 shadow-sm space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
					<Users
						className="h-4 w-4 sm:h-5 sm:w-5 text-violet-600"
						aria-hidden
					/>
					Players
				</h2>

				<label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
					<Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
					<input
						type="search"
						value={userSearch}
						onChange={(e) => setUserSearch(e.target.value)}
						placeholder="Search players…"
						className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none dark:text-white"
						aria-label="Search users"
					/>
				</label>

				{usersLoading ? (
					<div className="flex justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin text-gray-400" />
					</div>
				) : filteredUsers.length === 0 ? (
					<p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
						No players found.
					</p>
				) : (
					<div className="space-y-3">
						{filteredUsers.map((user) => {
							const isEditing = editingUserId === user.id;
							const isSaving = savingUserId === user.id;
							const isInviting = invitingUserId === user.id;
							const displayName =
								user.display_name ||
								user.username ||
								user.pocket_id_sub?.slice(0, 8) ||
								`user-${user.id}`;
							const handle = user.username ? `@${user.username}` : "";
							const skill =
								user.self_assessed_skill != null &&
								user.self_assessed_skill >= 1 &&
								user.self_assessed_skill <= 5
									? user.self_assessed_skill
									: user.calculated_skill != null
										? Math.min(
												5,
												Math.max(1, Math.round(user.calculated_skill)),
											)
										: null;
							const showInviteResult = inviteResult?.userId === user.id;

							return (
								<div
									key={user.id}
									className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden transition-colors"
								>
									{isEditing ? (
										/* Edit form */
										<div className="p-4 space-y-3">
											<div className="flex items-center gap-3 mb-1">
												<PlayerAvatarFace
													name={displayName}
													avatarUrl={user.avatar_url ?? undefined}
													size="lg"
												/>
												<div className="min-w-0">
													<span className="font-medium text-gray-900 dark:text-gray-100 text-sm">
														{displayName}
													</span>
													{handle && (
														<div className="text-xs text-gray-500 truncate">
															{handle}
														</div>
													)}
												</div>
											</div>

											{/* Display name */}
											<div>
												<label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
													Display name
												</label>
												<input
													type="text"
													value={editDisplayName}
													onChange={(e) => setEditDisplayName(e.target.value)}
													placeholder="e.g. John Smith"
													className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm dark:text-white"
												/>
											</div>

											{/* Self skill — star rating, full row */}
											<div>
												<label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
													Self skill
												</label>
												<StarRating
													value={editSkill}
													onChange={(v) => setEditSkill(v)}
													size={28}
												/>
											</div>

											{/* Primary position — full row */}
											<div>
												<label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
													Primary position
												</label>
												<select
													value={editPrimary}
													onChange={(e) => setEditPrimary(e.target.value)}
													className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm dark:text-white"
												>
													<option value="">— unset —</option>
													{SPECIALTIES.map((s) => (
														<option key={s} value={s}>
															{s}
														</option>
													))}
												</select>
											</div>

											{/* Secondary position — full row */}
											<div>
												<label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
													Secondary position
												</label>
												<select
													value={editSecondary}
													onChange={(e) => setEditSecondary(e.target.value)}
													className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm dark:text-white"
												>
													<option value="">— unset —</option>
													{SPECIALTIES.map((s) => (
														<option key={s} value={s}>
															{s}
														</option>
													))}
												</select>
											</div>

											{/* Admin checkbox + Delete */}
											<div className="flex items-center justify-between">
												<label className="inline-flex items-center gap-2 cursor-pointer">
													<input
														type="checkbox"
														checked={editIsAdmin}
														onChange={(e) => setEditIsAdmin(e.target.checked)}
														className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
													/>
													<span className="text-sm text-gray-700 dark:text-gray-300">
														Admin
													</span>
												</label>
												<button
													type="button"
													onClick={() => void deleteUser(user)}
													className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
												>
													<Trash2 className="h-3.5 w-3.5" />
													Delete
												</button>
											</div>

											<div className="flex gap-2 pt-1">
												<button
													type="button"
													disabled={isSaving}
													onClick={() => void saveEdit(user)}
													className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98]"
												>
													{isSaving ? (
														<Loader2 className="h-4 w-4 animate-spin" />
													) : null}
													Save
												</button>
												<button
													type="button"
													onClick={cancelEdit}
													className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800 active:scale-[0.98]"
												>
													<X className="h-4 w-4" />
													Cancel
												</button>
											</div>
										</div>
									) : (
										/* Read-only card */
										<div className="p-4">
											<div className="flex items-start gap-3">
												<PlayerAvatarFace
													name={displayName}
													avatarUrl={user.avatar_url ?? undefined}
													size="lg"
												/>
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2">
														<span className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">
															{displayName}
														</span>
														{skill != null && (
															<SkillBadge score={skill} size="sm" />
														)}
													</div>
													{handle && (
														<div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
															{handle}
														</div>
													)}
												</div>
											</div>

											{/* Metadata row */}
											<div className="flex flex-wrap items-center gap-2 mt-3">
												{user.primary_specialty && (
													<span className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
														{user.primary_specialty}
														{user.secondary_specialty && (
															<span className="text-blue-400 dark:text-blue-500">
																{" "}
																/ {user.secondary_specialty}
															</span>
														)}
													</span>
												)}
												{user.calculated_skill != null && (
													<span className="inline-flex items-center rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400">
														calc {user.calculated_skill}
													</span>
												)}
												{user.is_admin && (
													<span className="inline-flex items-center rounded-md bg-violet-100 dark:bg-violet-950/50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
														Admin
													</span>
												)}
												{user.has_pocket_id ? (
													<span className="inline-flex items-center rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
														Pocket ID linked
													</span>
												) : (
													<span className="inline-flex items-center rounded-md bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
														Not linked
													</span>
												)}
											</div>

											{/* Invite result */}
											{showInviteResult && inviteResult && (
												<div className="mt-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-3">
													<p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
														Invite ready — share this link or QR code:
													</p>
													<div className="flex flex-wrap items-center gap-3">
														<input
															readOnly
															value={inviteResult.invite_link}
															className="min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-1.5 text-xs font-mono dark:text-gray-200 transition-colors"
															onClick={(e) =>
																(e.target as HTMLInputElement).select()
															}
														/>
														<button
															type="button"
															onClick={() =>
																void shareLinkInvite(inviteResult.invite_link)
															}
															className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800 transition-colors"
														>
															<Share className="h-3.5 w-3.5" aria-hidden />
															Share
														</button>
														<button
															type="button"
															onClick={() =>
																void copyLink(inviteResult.invite_link)
															}
															className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800 transition-colors"
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
														<p className="text-xs text-gray-500 dark:text-gray-400">
															Scan with phone camera to open the signup link.
														</p>
													</div>
												</div>
											)}

											{/* Action buttons */}
											<div className="mt-3 flex gap-2">
												{!user.has_pocket_id && (
													<button
														type="button"
														disabled={isInviting}
														onClick={() => void generateInvite(user)}
														className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50 active:scale-[0.98] transition-colors"
													>
														{isInviting ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : (
															<Mail className="h-3.5 w-3.5" />
														)}
														Invite to Pocket ID
													</button>
												)}
												<button
													type="button"
													onClick={() => startEdit(user)}
													className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60 active:scale-[0.98] transition-colors"
												>
													<Pencil className="h-3.5 w-3.5" />
													Edit
												</button>
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</section>

			{/* Invite history */}
			<section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-6 shadow-sm space-y-4">
				<h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
					<Mail className="h-4 w-4 sm:h-5 sm:w-5 text-violet-600" aria-hidden />
					Invite history
				</h2>

				{inviteHistoryLoading ? (
					<div className="flex justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin text-gray-400" />
					</div>
				) : inviteHistory.length === 0 ? (
					<p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
						No invites created yet.
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500 dark:text-gray-400">
									<th className="pb-2 pr-4 font-medium">Player</th>
									<th className="pb-2 pr-4 font-medium hidden sm:table-cell">
										Created
									</th>
									<th className="pb-2 pr-4 font-medium hidden sm:table-cell">
										Expires
									</th>
									<th className="pb-2 pr-4 font-medium">Status</th>
									<th className="pb-2 font-medium">Link</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100 dark:divide-gray-800">
								{inviteHistory.map((row) => {
									const expired = new Date(row.expires_at) < new Date();
									const name = `${row.first_name} ${row.last_name}`;
									return (
										<tr
											key={row.token}
											className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
										>
											<td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-gray-100">
												{name}
											</td>
											<td className="py-2.5 pr-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
												{new Date(row.created_at).toLocaleDateString()}
											</td>
											<td className="py-2.5 pr-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
												{new Date(row.expires_at).toLocaleDateString()}
											</td>
											<td className="py-2.5 pr-4">
												{row.used ? (
													<span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
														<Check className="h-3.5 w-3.5" aria-hidden /> Used
													</span>
												) : expired ? (
													<span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
														<XCircle className="h-3.5 w-3.5" aria-hidden />{" "}
														Expired
													</span>
												) : (
													<span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
														<Mail className="h-3.5 w-3.5" aria-hidden /> Active
													</span>
												)}
											</td>
											<td className="py-2.5">
												<button
													type="button"
													onClick={() => void copyLink(row.invite_link)}
													className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800 transition-colors"
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
