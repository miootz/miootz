import { apiFetch, parseApiError } from './client';

export type AuditCategory =
	| 'meetup'
	| 'attendance'
	| 'teams'
	| 'match'
	| 'referee'
	| 'template'
	| 'user'
	| 'rating'
	| 'plus_one';

export interface AuditLogRow {
	id: number;
	/** Naive UTC ISO (app-wide SQLite convention) */
	created_at: string;
	user_id: number | null;
	username: string | null;
	display_name: string | null;
	is_admin: boolean;
	category: string;
	/** Machine action name, e.g. "meetup.created" */
	action: string;
	description: string;
	meetup_id: number | null;
	meetup_start_time: string | null;
}

export interface AuditPivotRow {
	key: string;
	count: number;
}

export interface AuditLogQuery {
	q?: string;
	category?: AuditCategory | string;
	/** Naive-UTC ISO bounds (inclusive) */
	start?: string;
	end?: string;
	order?: 'desc' | 'asc';
	limit?: number;
	offset?: number;
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
	if (!r.ok) throw new Error(await parseApiError(r));
	return r.json() as Promise<T>;
}

function toQuery(p: AuditLogQuery): string {
	const s = new URLSearchParams();
	if (p.q) s.set('q', p.q);
	if (p.category) s.set('category', p.category);
	if (p.start) s.set('start', p.start);
	if (p.end) s.set('end', p.end);
	if (p.order) s.set('order', p.order);
	if (p.limit != null) s.set('limit', String(p.limit));
	if (p.offset != null) s.set('offset', String(p.offset));
	const qs = s.toString();
	return qs ? `?${qs}` : '';
}

export async function adminAuditLogs(
	p: AuditLogQuery
): Promise<{ items: AuditLogRow[]; total: number }> {
	const r = await apiFetch(`/audit/logs${toQuery(p)}`);
	return jsonOrThrow(r);
}

export async function adminAuditPivot(
	p: AuditLogQuery & { groupBy: 'category' | 'user' }
): Promise<{ items: AuditPivotRow[] }> {
	const q = toQuery(p);
	const r = await apiFetch(`/audit/logs${q}${q ? '&' : '?'}group_by=${p.groupBy}`);
	return jsonOrThrow(r);
}
