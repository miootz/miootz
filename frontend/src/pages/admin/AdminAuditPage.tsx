import { useCallback, useEffect, useState } from "react";
import {
	ArrowDown,
	ArrowUp,
	CalendarDays,
	ChevronRight,
	CloudSun,
	Filter,
	Repeat,
	RotateCcw,
	Search,
	ShieldCheck,
	Star,
	Trophy,
	UserCog,
	UserPlus,
	Users,
	Flag,
} from "lucide-react";
import {
	adminAuditLogs,
	adminAuditPivot,
	type AuditLogRow,
	type AuditPivotRow,
} from "../../api/auditApi";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { parseMeetupStart } from "../../utils/datetime";

const PAGE_SIZE = 50;

const CATEGORY_META: Record<string, { label: string; icon: typeof Users }> = {
	meetup: { label: "Meetup", icon: CalendarDays },
	attendance: { label: "Attendance", icon: Users },
	teams: { label: "Teams", icon: ShieldCheck },
	match: { label: "Match", icon: Trophy },
	referee: { label: "Referee", icon: Flag },
	template: { label: "Template", icon: Repeat },
	user: { label: "User", icon: UserCog },
	rating: { label: "Rating", icon: Star },
	plus_one: { label: "Plus-one", icon: UserPlus },
};

function categoryIcon(category: string) {
	return CATEGORY_META[category]?.icon ?? CloudSun;
}

function categoryLabel(category: string) {
	return CATEGORY_META[category]?.label ?? category;
}

/** "meetup.created" → "Created" */
function actionLabel(action: string): string {
	const verb = action.split(".").pop() ?? action;
	return verb
		.replace(/_/g, " ")
		.replace(/^./, (c) => c.toUpperCase());
}

/** Compact time: 12m · 3h · 14:32 (today) · Nov 3 — exact value in tooltip. */
function compactTime(d: Date): string {
	const now = new Date();
	const diff = (now.getTime() - d.getTime()) / 1000;
	if (diff < 60) return "now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function exactTime(d: Date): string {
	return d.toLocaleString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

type Preset = "all" | "today" | "24h" | "7d" | "30d";

const PRESETS: Array<{ id: Preset; label: string }> = [
	{ id: "today", label: "Today" },
	{ id: "24h", label: "24 h" },
	{ id: "7d", label: "7 d" },
	{ id: "30d", label: "30 d" },
	{ id: "all", label: "All" },
];

function toNaiveUtcIso(d: Date): string {
	return d.toISOString().slice(0, 19);
}

function presetRange(p: Preset): { start?: string; end?: string } {
	if (p === "all") return {};
	const now = new Date();
	if (p === "today") {
		const s = new Date(now);
		s.setHours(0, 0, 0, 0);
		return { start: toNaiveUtcIso(s) };
	}
	const days = p === "24h" ? 1 : p === "7d" ? 7 : 30;
	return { start: toNaiveUtcIso(new Date(now.getTime() - days * 86400000)) };
}

/** `<input type="datetime-local">` value (local) → naive-UTC ISO. */
function localToNaiveUtc(value: string): string | undefined {
	if (!value) return undefined;
	const d = new Date(`${value}Z`);
	if (Number.isNaN(d.getTime())) return undefined;
	return toNaiveUtcIso(d);
}

type View = "log" | "category" | "user";

export function AdminAuditPage() {
	// Filters
	const [search, setSearch] = useState("");
	const [appliedQ, setAppliedQ] = useState("");
	const [category, setCategory] = useState<string | null>(null);
	const [preset, setPreset] = useState<Preset>("all");
	const [customStart, setCustomStart] = useState("");
	const [customEnd, setCustomEnd] = useState("");
	const [filtersOpen, setFiltersOpen] = useState(false);

	// View + sort
	const [view, setView] = useState<View>("log");
	const [order, setOrder] = useState<"desc" | "asc">("desc");

	// Data
	const [rows, setRows] = useState<AuditLogRow[]>([]);
	const [total, setTotal] = useState(0);
	const [pivotRows, setPivotRows] = useState<AuditPivotRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [expandedId, setExpandedId] = useState<number | null>(null);

	// Debounce search (house pattern: 300 ms).
	useEffect(() => {
		const t = setTimeout(() => {
			setAppliedQ(search.trim());
		}, 300);
		return () => clearTimeout(t);
	}, [search]);

	const start = localToNaiveUtc(customStart) ?? presetRange(preset).start;
	const end = localToNaiveUtc(customEnd) ?? presetRange(preset).end;

	const loadLog = useCallback(
		async (offset: number) => {
			setLoading(true);
			setError("");
			try {
				const r = await adminAuditLogs({
					q: appliedQ || undefined,
					category: category ?? undefined,
					start,
					end,
					order,
					limit: PAGE_SIZE,
					offset,
				});
				setRows((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
				setTotal(r.total);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to load the audit log");
			} finally {
				setLoading(false);
			}
		},
		[appliedQ, category, start, end, order],
	);

	const loadPivot = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			const groupBy: "category" | "user" = view === "user" ? "user" : "category";
			const r = await adminAuditPivot({
				q: appliedQ || undefined,
				category: category ?? undefined,
				start,
				end,
				groupBy,
			});
			setPivotRows(r.items);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load the audit log");
		} finally {
			setLoading(false);
		}
	}, [appliedQ, category, start, end, view]);

	useEffect(() => {
		setExpandedId(null);
		if (view === "log") void loadLog(0);
		else void loadPivot();
	}, [view, loadLog, loadPivot]);

	const hasFilters =
		Boolean(appliedQ) || category != null || preset !== "all" ||
		Boolean(customStart) || Boolean(customEnd);

	function clearFilters() {
		setSearch("");
		setAppliedQ("");
		setCategory(null);
		setPreset("all");
		setCustomStart("");
		setCustomEnd("");
	}

	// Pivot drill-in: category row filters by category; user row filters by
	// username (the server search matches usernames).
	function drillIn(key: string) {
		if (view === "user") setQSearch(key);
		else setCategory(key);
		setView("log");
	}
	function setQSearch(v: string) {
		setSearch(v);
		setAppliedQ(v);
	}

	const activeFilterCount =
		Number(Boolean(appliedQ)) +
		Number(category != null) +
		Number(preset !== "all") +
		Number(Boolean(customStart)) +
		Number(Boolean(customEnd));

	const viewBtn = (id: View, label: string) => (
		<button
			type="button"
			onClick={() => setView(id)}
			aria-pressed={view === id}
			className={`flex-1 px-2 py-1.5 text-xs font-bold transition-colors ${
				view === id ? "bg-ink text-board" : "text-ink-dim hover:text-ink"
			}`}
		>
			{label}
		</button>
	);

	return (
		<div className="p-2 sm:p-4 max-w-4xl mx-auto space-y-4">
			<AdminBreadcrumb
				items={[{ label: "Admin", to: "/admin" }, { label: "Audit" }]}
			/>
			<AdminPageHeader
				title="Audit"
				subtitle="Every action in the app — who did what, and when. Read-only."
			/>

			<section className="border border-line bg-panel">
				{/* Control bar */}
				<div className="p-3 sm:p-4 space-y-3">
					<div className="flex gap-2">
						<label className="flex min-w-0 flex-1 items-center gap-2 border border-line bg-raised px-3 py-2.5">
							<Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
							<input
								type="search"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search who or what…"
								aria-label="Search the audit log"
								className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-faint focus:outline-hidden"
							/>
						</label>
						<button
							type="button"
							onClick={() => setFiltersOpen((v) => !v)}
							aria-expanded={filtersOpen}
							className={`inline-flex items-center gap-1.5 border px-3 py-2.5 text-xs font-bold transition-colors ${
								filtersOpen || activeFilterCount > 0
									? "border-live text-live bg-live/10"
									: "border-line text-ink-dim hover:bg-raised hover:text-ink"
							}`}
						>
							<Filter className="h-3.5 w-3.5" aria-hidden />
							Filters
							{activeFilterCount > 0 && (
								<span className="tabular-nums">{activeFilterCount}</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
							aria-label={order === "desc" ? "Newest first" : "Oldest first"}
							title={order === "desc" ? "Newest first" : "Oldest first"}
							className="inline-flex items-center border border-line px-3 py-2.5 text-ink-dim hover:bg-raised hover:text-ink transition-colors"
						>
							{order === "desc" ? (
								<ArrowDown className="h-4 w-4" aria-hidden />
							) : (
								<ArrowUp className="h-4 w-4" aria-hidden />
							)}
						</button>
					</div>

					<div className="flex border border-line bg-raised p-0.5">
						{viewBtn("log", "Log")}
						{viewBtn("category", "By category")}
						{viewBtn("user", "By user")}
					</div>

					{filtersOpen && (
						<div className="space-y-3 border-t border-line pt-3">
							<div className="flex flex-wrap gap-1.5">
								{Object.entries(CATEGORY_META).map(([id, meta]) => (
									<button
										key={id}
										type="button"
										onClick={() =>
											setCategory((c) => (c === id ? null : id))
										}
										aria-pressed={category === id}
										className={`inline-flex items-center gap-1.5 border px-2.5 py-2 text-xs font-medium transition-colors ${
											category === id
												? "border-live bg-live/10 text-live"
												: "border-line text-ink-dim hover:bg-raised hover:text-ink"
										}`}
									>
										<meta.icon className="h-3.5 w-3.5" aria-hidden />
										{meta.label}
									</button>
								))}
							</div>
							<div className="flex flex-wrap items-center gap-1.5">
								{PRESETS.map((p) => (
									<button
										key={p.id}
										type="button"
										onClick={() => {
											setPreset(p.id);
											setCustomStart("");
											setCustomEnd("");
										}}
										aria-pressed={preset === p.id && !customStart && !customEnd}
										className={`px-2.5 py-2 text-xs font-medium transition-colors ${
											preset === p.id && !customStart && !customEnd
												? "bg-ink text-board"
												: "border border-line text-ink-dim hover:bg-raised hover:text-ink"
										}`}
									>
										{p.label}
									</button>
								))}
								<label className="flex flex-wrap items-center gap-1.5 text-xs text-ink-dim">
									<span className="sr-only">From</span>
									<input
										type="datetime-local"
										value={customStart}
										onChange={(e) => setCustomStart(e.target.value)}
										aria-label="From (custom range)"
										className="border border-line bg-raised px-2 py-1.5 text-xs text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
									/>
									<span>→</span>
									<input
										type="datetime-local"
										value={customEnd}
										onChange={(e) => setCustomEnd(e.target.value)}
										aria-label="Until (custom range)"
										className="border border-line bg-raised px-2 py-1.5 text-xs text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
									/>
								</label>
							</div>
						</div>
					)}
				</div>

				{/* Results */}
				<div className="border-t border-line" aria-live="polite">
					{loading ? (
						<ul className="divide-y divide-line">
							{Array.from({ length: 6 }).map((_, i) => (
								<li key={i} className="px-3 sm:px-4 py-3">
									<div className="flex items-center gap-2.5 animate-pulse">
										<div className="h-4 w-4 bg-raised" />
										<div className="flex-1 space-y-1.5">
											<div className="h-3 w-2/3 bg-raised" />
											<div className="h-2.5 w-full bg-raised" />
										</div>
										<div className="h-3 w-8 bg-raised" />
									</div>
								</li>
							))}
						</ul>
					) : error ? (
						<div className="p-6 text-center space-y-3">
							<p className="text-sm text-danger">{error}</p>
							<button
								type="button"
								onClick={() =>
									view === "log" ? void loadLog(0) : void loadPivot()
								}
								className="inline-flex items-center gap-1.5 border border-line px-3 py-2 text-xs font-bold text-ink-dim hover:bg-raised hover:text-ink transition-colors"
							>
								<RotateCcw className="h-3.5 w-3.5" aria-hidden />
								Retry
							</button>
						</div>
					) : view === "log" ? (
						rows.length === 0 ? (
							<div className="p-6 text-center space-y-3">
								<p className="text-sm text-ink-dim">
									{hasFilters
										? "No actions match your filters."
										: "Actions will appear here as they happen."}
								</p>
								{hasFilters && (
									<button
										type="button"
										onClick={clearFilters}
										className="inline-flex items-center gap-1.5 border border-line px-3 py-2 text-xs font-bold text-ink-dim hover:bg-raised hover:text-ink transition-colors"
									>
										<RotateCcw className="h-3.5 w-3.5" aria-hidden />
										Clear filters
									</button>
								)}
							</div>
						) : (
							<>
								<ul className="divide-y divide-line">
									{rows.map((row) => {
										const d = parseMeetupStart(row.created_at);
										const meetupDate = row.meetup_start_time
											? parseMeetupStart(row.meetup_start_time)
											: null;
										const Icon = categoryIcon(row.category);
										const expanded = expandedId === row.id;
										const who =
											row.display_name || row.username || `user-${row.user_id}`;
										return (
											<li key={row.id}>
												<button
													type="button"
													onClick={() =>
														setExpandedId(expanded ? null : row.id)
													}
													aria-expanded={expanded}
													className={`w-full text-left px-3 sm:px-4 py-2.5 transition-colors ${
														expanded ? "bg-raised" : "hover:bg-raised"
													}`}
												>
													<span className="flex items-start gap-2.5">
														<Icon
															className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint"
															aria-hidden
														/>
														<span className="min-w-0 flex-1">
															<span className="flex items-baseline gap-2">
																<span className="min-w-0 truncate text-sm font-semibold text-ink">
																	{actionLabel(row.action)}
																</span>
																<span
																	className="ml-auto shrink-0 text-xs tabular-nums text-ink-faint"
																	title={exactTime(d)}
																>
																	{compactTime(d)}
																</span>
															</span>
															<span className="mt-0.5 block truncate text-xs text-ink-dim sm:line-clamp-2">
																{row.description}
															</span>
															<span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
																<span className="truncate text-xs text-ink-dim">
																	{who}
																</span>
																{row.is_admin && (
																	<span className="shrink-0 bg-live/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-live">
																		Admin
																	</span>
																)}
																{meetupDate && (
																	<span className="text-xs tabular-nums text-ink-dim">
																		Meetup{" "}
																		<time dateTime={meetupDate.toISOString()}>
																			{meetupDate.toLocaleString([], {
																				year: "numeric", month: "short", day: "numeric",
																				hour: "2-digit", minute: "2-digit",
																			})}
																		</time>
																	</span>
																)}
															</span>
														</span>
													</span>
												</button>
												{expanded && (
													<div className="space-y-1 px-3 sm:px-4 pb-3 pl-9 text-xs text-ink-dim">
														<p className="text-sm text-ink">{row.description}</p>
														<p className="tabular-nums">
															Recorded {exactTime(d)} (local)
														</p>
														<p>
															{categoryLabel(row.category)} ·{" "}
															<code className="text-ink-faint">{row.action}</code>
															{!meetupDate && row.meetup_id != null &&
																` · meetup ${row.meetup_id}`}
														</p>
													</div>
												)}
											</li>
										);
									})}
								</ul>
								{total > rows.length && (
									<div className="p-3 text-center">
										<button
											type="button"
											onClick={() => void loadLog(rows.length)}
											className="inline-flex items-center gap-1.5 border border-line px-4 py-2.5 text-xs font-bold text-ink-dim hover:bg-raised hover:text-ink transition-colors"
										>
											Load older · {total - rows.length} remaining
										</button>
									</div>
								)}
							</>
						)
					) : pivotRows.length === 0 ? (
						<div className="p-6 text-center">
							<p className="text-sm text-ink-dim">
								{hasFilters
									? "No actions match your filters."
									: "No actions recorded yet."}
							</p>
						</div>
					) : (
						<ul className="divide-y divide-line">
							{pivotRows.map((p) => {
								const Icon =
									view === "category"
										? categoryIcon(p.key)
										: view === "user"
											? UserCog
											: Users;
								const max = Math.max(...pivotRows.map((x) => x.count));
								return (
									<li key={p.key}>
										<button
											type="button"
											onClick={() => drillIn(p.key)}
											className="flex w-full items-center gap-3 px-3 sm:px-4 py-3 text-left hover:bg-raised transition-colors"
										>
											<Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
											<span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
												{view === "category"
													? categoryLabel(p.key)
													: p.key}
											</span>
											<span className="hidden h-1 w-24 shrink-0 bg-raised sm:block">
												<span
													className="block h-full bg-live"
													style={{ width: `${(p.count / max) * 100}%` }}
												/>
											</span>
											<span className="shrink-0 text-xs tabular-nums text-ink-faint">
												{p.count}
											</span>
											<ChevronRight
												className="h-4 w-4 shrink-0 text-ink-faint"
												aria-hidden
											/>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</section>
		</div>
	);
}
