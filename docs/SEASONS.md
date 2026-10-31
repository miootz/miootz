# Yearly Seasons & Player Rankings

Plan for calendar-year seasons (stats reset every January 1st), a Rankings page
in the player UI with season navigation, and per-meetup rankings on the meetup
history page.

## Concept: seasons are a filter, not a migration

A **season** is a calendar year (Jan 1st 00:00 UTC → Dec 31st 23:59 UTC), the
same convention `season_games` already uses in `app/services/stats_service.py`.

- **"Reset on January 1st"** is achieved at query time: season stats filter
  event timestamps to the selected year; all-time stats use no filter. Nothing
  is deleted or rewritten — attendance, `MatchGoal` and rating rows are
  immutable history, and a new season's numbers start from zero by
  construction.
- Consequences: no scheduled job, no `seasons` table. All datetimes are naive
  UTC (`app/core/timeutil.utcnow()`), so the boundary is a naive-UTC year.
- Season navigation is in scope: the API takes `year=YYYY` (default: current
  year) plus `year=all`, and the page can step between any year that has data.

## Crediting rules (what counts)

All player metrics are derived **strictly from the explicit fields on each
`MatchGoal` row** — never imputed:

- **Scorer** (`scorer_id`): always credited.
- **Assist** (`assist_id`): credited only when a player is explicitly
  mentioned; a goal with no assist credits only the scorer.
- **Goalkeeper** (`goalkeeper_id`): goals-conceded is credited only when a
  keeper is explicitly mentioned in the goal details.
- **Own goals**: a new `is_own_goal` flag on `MatchGoal` (see below). By
  default, the **goals scored** table counts only goals scored against the
  opposing team; an "Include own goals" toggle counts own goals separately,
  credited to the explicitly mentioned scorer.
- **Clean sheets** are a **team metric**: in a completed match, if zero goals
  were scored against a team, **every member of that team's roster** gets a
  clean-sheet credit for the game. (Not keeper-only.)
- Soft-deleted `MatchGoal` rows never count. Goal/assist/goals-conceded counts
  come from `MatchGoal` rows — the same source the live score recompute
  (`_goal_counts` in `app/api/matches.py`) uses.

## Model & API change: own goals

1. `app/models/match_goal.py` — `MatchGoal.is_own_goal: Mapped[bool] =
   mapped_column(Boolean, default=False)`.
2. `app/core/migrations.py` — additive migration in the existing pattern:
   `ALTER TABLE match_goals ADD COLUMN is_own_goal INTEGER DEFAULT 0` (guarded
   by `has_column`, like the `goalkeeper_id` block).
3. `GoalCreate` schema + `create_goal` in `app/api/matches.py` — accept
   `is_own_goal`; validation flips for own goals: the **scorer must be on the
   conceding team** (the player who put it in their own net), assist must be a
   different player, goalkeeper rules unchanged.
4. Frontend: own-goal toggle in `components/GoalEntrySheet.tsx`; "OG" marker
   in `components/GoalList.tsx`.
5. Demo data: seed 1–2 own goals in `app/demo_data.py` (scorer drawn from the
   conceding team) so the toggle and OG marker have coverage; extend
   `test_demo_data.py`.

## Metrics and sources

| Column | Metric | Source | Year filter column |
|--------|--------|--------|--------------------|
| Attendances | confirmed attendances | `Attendance` (`status='confirmed'`) joined to `Meetup` | `Meetup.start_time` (existing convention) |
| Goals scored | goals vs the opposing team | `MatchGoal.scorer_id` (`deleted_at IS NULL`, `is_own_goal` per toggle) joined to `MeetupMatch` | `MeetupMatch.completed_at` |
| Assists | assists | `MatchGoal.assist_id` | `MeetupMatch.completed_at` |
| Clean sheets | zero goals against the player's team in a completed match; credited to the whole roster (JSON roster scan, existing `_loads_int_list` pattern) | completed `MeetupMatch` | `MeetupMatch.completed_at` |
| Goals conceded | `MatchGoal.goalkeeper_id` (keeper-of-record, including the fallback defender listed for keeperless teams) | `MatchGoal` | `MeetupMatch.completed_at` |

Tie-break order when sorting by the primary column: primary desc, then the
next column desc (goals conceded asc), then display name A→Z. Column sorting
is **server-side** (`sort` + `order` params) so ordering stays correct across
pages; default sort is attendances desc.

## Backend

1. `app/services/rankings_service.py` — one aggregation helper per metric,
   all taking an optional `year` filter (year range bounds in naive UTC):

   ```
   async def get_rankings(db, *, year: int | None = None,
                          include_own_goals: bool = False,
                          sort: str = "attendances", order: str = "desc",
                          page: int = 1, per_page: int = 25) -> dict
   async def get_meetup_rankings(db, meetup_id: int) -> dict
   ```

   Rows are **players** (one row per user, all metric columns), not
   per-category lists — this matches the single sortable table.
   **Players with 0 confirmed attendance in the selected scope are excluded**
   entirely. Pagination: 25 per page by default. The response also carries
   `available_years` — sorted distinct years that have confirmed attendance —
   so the client can render season navigation (prev/next disabled at the
   bounds).

2. `app/schemas/rankings.py` — `RankingRow {user {id, display_name,
   avatar_url}, attendances, goals, assists, clean_sheets, goals_conceded}`
   plus the response envelope `{year, available_years, page, per_page, total,
   rows}`.

3. `app/api/rankings.py` — router (default-deny: any authenticated member,
   matching the rest of the member API):

   - `GET /rankings?year=YYYY|all&include_own_goals=0|1&sort=<column>&order=asc|desc&page=N&per_page=25`
     — `year` defaults to the current season.
   - `GET /meetups/{meetup_id}/rankings` — same row shape scoped to that
     meetup (single page; no year param); `404` if the meetup has no completed
     matches.

   Register in `app/api/main.py` alongside the other routers.

4. Small reuse: extend `get_user_statistics` (`app/services/stats_service.py`)
   with `goals`, `assists`, `clean_sheets`, `goals_conceded` (season +
   all-time) via the same aggregation helpers, and the matching
   `app/schemas/stats.py` fields — the profile page already renders
   `UserStats`, so this is a few fields, not a new surface.

## Frontend

1. `frontend/src/api/rankingsApi.ts` — `apiFetch` wrappers for both endpoints
   (types mirroring the schemas).

2. `frontend/src/pages/RankingsPage.tsx` — player UI page:
   - **Season navigation**: `‹ 2025 · 2026 · 2027 ›`-style year switcher fed
     by `available_years`, defaults to the current season, plus an
     **All time** option. Changing the year resets to page 1 and re-applies
     the current sort.
   - "Include own goals" toggle (off by default).
   - **Tablet/desktop (sm and up): one table**, columns *Player · Attendances
     · Goals scored · Assists · Clean sheets · Goals conceded*, sortable
     column headers (click toggles asc/desc, second click returns to default).
   - **Mobile (below sm): tabs** — *Attendances · Goals scored · Assists ·
     Goals conceded* — each a ranked list; clean sheets appear from tablet up
     (it is a team credit and shows in the wide table).
   - Pagination: 25 per page, prev/next controls.
   - Shareable `RankingsTable` component so the history page reuses it.
   - Highlight the viewer's own row when present.
   - Route `/rankings` under `MemberLayout` in `frontend/src/App.tsx`; nav
     entry in `frontend/src/layout/MemberLayout.tsx`.

3. `frontend/src/pages/HistoryMeetupPage.tsx` — after
   `MeetupDetailPanel`, a "Top performers" section (collapsible) calling
   `GET /meetups/{id}/rankings` with the same sortable table / mobile tabs;
   hidden when the meetup has no completed matches (endpoint 404s).

## Tests

- Own goals:
  - `create_goal` validation — own goal scorer must be on the conceding team;
    normal goal scorer must not be.
  - `is_own_goal` migration fires on an old-schema DB and is a no-op on a
    fresh one.
  - Rankings exclude own goals by default; the toggle credits them to the
    listed scorer.
- Clean sheets: every roster member of a team that conceded 0 gets a credit;
  one conceded goal → no credits for the team; incomplete matches never
  count.
- Crediting: null `assist_id`/`goalkeeper_id` credit no one.
- Season boundary: an event on Dec 31st of year N is absent from year N+1's
  scope and present in N's; `available_years` matches the data.
- Exclusion & pagination: zero-attendance players absent; page boundaries and
  `total` correct with the 25/page default; server-side sort order across
  pages.
- Meetup-scoped endpoint: correct scoping + 404 with no completed matches.
- Demo data: `test_demo_data.py` assertions cover the seeded own goals.
- Frontend: `npm run lint` + build; manual check via `python -m app.demo`.

## Out of scope

- Configurable season boundaries or timezone-adjusted reset (UTC calendar
  years only).
- No data migration or retroactive reset of any stored rows.
- Saves and other goalkeeper metrics (not recorded by the goal entry flow).

## Order of work

1. `is_own_goal`: model + migration + `GoalCreate`/`create_goal` validation +
   demo seed + tests.
2. `GoalEntrySheet` toggle + `GoalList` OG marker.
3. `rankings_service.py` + schemas + `rankings.py` router (year/sort/paginated,
   tested).
4. Extend `get_user_statistics` with the new metric fields.
5. `rankingsApi.ts` + `RankingsPage` (season nav, sortable table, mobile
   tabs, pagination) + route/nav.
6. "Top performers" section in `HistoryMeetupPage`.
