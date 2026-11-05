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

---

# Night & Season Stats Reporting (v2)

Plan to bring the meetup history, the self-profile and the season-wide
rankings up to the stats level of a reference "night report" (per-meetup
night stats + season-so-far highlights). Almost all of it is query-time
aggregation over data we already store — the only storage change is one
additive `MeetupMatch.winner_team` column so win stats stay deterministic
for tied matches (see §3).

## 1. Deterministic statistics in the reference report

Post-meetup (one meetup = one "night"):

| Stat | Values | Where shown |
|------|--------|-------------|
| Night KPIs | match count, total goals, distinct players, one-goal-margin wins | header tiles |
| Per-team night record | team name, wins / matches, goals for – goals against, goal difference, clean sheets, roster with mid-meetup swap annotations | "The teams" cards |
| Per-player night row | team (incl. swap path, e.g. "B → C"), matches, wins, win %, goals, assists | "Every player" table |
| Per-match list | match number, both team names, score, scorers per side, draw note | "All matches" list |
| Per-player bars | goals bar, assists bar (same data as the per-player row, charted) | charts |

Season-wide ("season so far", N nights):

| Stat | Values |
|------|--------|
| Top goals | top players, name + count |
| Top assists | top players, name + count |
| Top goals + assists | top players, name + combined count |
| Most wins | "N of M" (wins of matches played) |
| Top win rate | %, minimum 2+ nights |
| Most matches | name + count |

Ignored from the reference: AI-written summary prose, headline labels ("won
the night"), graphic design. The "draw goes to the fresh team" rule is that
league's stay-on/fresh format — we have no such format, so a draw is a draw
(see crediting below).

## 2. What we store today (and what is therefore computable)

| Scope | Stored | Used for |
|-------|--------|----------|
| Match (`MeetupMatch`) | final rosters `team_a_users`/`team_b_users` (JSON), `team_a_name`/`team_b_name`, `score_a/b` + offsets, `status`, `match_number`, `created_at`, `completed_at` | results, per-team records, per-player wins |
| Match pre-start swaps (`MatchSubstitution`) | self-contained before/after roster snapshots | display only — the match's own roster columns always hold the final state, so "team at the time" = final roster |
| Goal (`MatchGoal`) | `scorer_id`, `assist_id`, `goalkeeper_id`, `is_own_goal`, soft-delete | goals, assists, goals conceded, per-team GF/GA |
| Meetup | `start_time`, teams (`manual_teams_json`, names), capacity | season bounds, night identity |
| Player | `Attendance` (confirmed) per meetup; `Rating` per meetup | attendances, exclusion rule |
| Season | nothing — calendar-year query filter | all season stats |

Gap check: every stat in §1 derives from the rows above. Missing from today's
rankings output only: **per-player wins / win % / matches-played** (from final
rosters + scores) and the **per-team night record / night KPIs** (group
completed matches by team name). Nothing requires new storage.

## 3. Crediting rules (additions)

- **Match winner**: the source of truth is a new
  `MeetupMatch.winner_team: "a" | "b" | None` column (additive migration,
  same pattern as `is_own_goal`), written by `end_match`: derived from the
  scores when there is no tie, taken from the required `body.winner_team`
  when the score is tied. Today that tie-break decision exists only in
  memory (response + next-match build) — persisting it is what makes win
  stats deterministic. Stats fall back to the score columns when
  `winner_team` is null (rows completed before the migration).
- **Draws**: match prep already treats a tie as home-side-lost —
  `create_new_pending_match` auto-picks `team_b` whenever
  `score_a > score_b` is false (matches.py:560). Supporting true draws
  (tie stands, no winner) is a **separate change** behind a
  `GameTemplate.allows_draws` toggle (default `False` = home-team-loses, no
  draws). Stats rule for when it lands: a completed match with a tied score
  and `winner_team IS NULL` is a draw — no wins credited, not a
  one-goal-margin win; everything else unchanged.
- **Wins**: a completed match credits a win to every member of the **final**
  winning roster (winner per above). Substituted (swapped) players are
  credited via the final roster — the same convention the existing
  clean-sheet credit already uses (`MatchSubstitution` docstring: "The
  match's own team_*_users columns always hold the final state").
- **Matches played (player)**: count of completed matches whose final rosters
  include the player. Win % = wins / matches played (0 matches → 0).
- **Team night record**: completed matches grouped by team name
  (`team_a_name` / `team_b_name`). Wins / GF / GA / goal difference / clean
  sheets per group; roster = union of the final rosters that name played
  under. A mid-meetup reshape assigns fresh names, so pre- and post-reshape
  lineups naturally form separate records — history stays correct by
  construction, matching the reshape endpoint's contract.
- **Season win-rate highlight**: players with at least 2 matches played
  (mirrors the reference's 2+ nights threshold).
- Own goals count toward GF/GA (scores are the source of truth); the
  "Include own goals" toggle continues to apply only to the goals columns,
  unchanged.

## 4. Backend (extend `app/services/rankings_service.py`)

1. `MeetupMatch.winner_team: str | None` — new nullable column
   (`app/models/match.py`) + additive `ALTER TABLE` in
   `app/core/migrations.py`. `end_match` (`app/api/matches.py`) sets it:
   derived from the scores on a decisive result, from the required
   `body.winner_team` on a tie (the decision already exists there, it just
   is not persisted). `_aggregate` winner resolution: `winner_team` if set,
   else the score columns; tied score + null winner = draw (no wins).
2. `_aggregate` — add `wins` and `matches` to every per-user dict: loop the
   completed matches, +1 `matches` to each final-roster member, +1 `wins` to
   the winning roster (winner per 1). (Own-goal toggle does not affect
   wins.)
3. `SORTABLE_COLUMNS` — add `wins`, `win_rate` (computed = wins / matches),
   `goal_assists` (goals + assists, toggle-aware). Tie-break chain extends
   with `wins` under the existing goals/assists/clean-sheets order.
4. `get_rankings` — envelope gains `highlights`: top-3 lists (name + value)
   for `goals`, `assists`, `goal_assists`, `wins` ("N of M"), `win_rate`
   (2+ matches only), `attendances` — computed from the full in-scope row
   set, not the current page, so the page needs no extra request.
5. `get_meetup_rankings` — response gains a `night` block:
   `kpis {matches, goals, players, one_goal_wins}` and
   `teams [{name, wins, matches, goals_for, goals_against, goal_diff,
   clean_sheets, roster [{id, display_name}]}]`, teams sorted by wins desc
   then goal_diff desc. `players` = distinct user ids across all final
   rosters; `one_goal_wins` = matches where the score difference is 1.
6. `app/schemas/rankings.py` — `RankingRow` += `wins`, `matches`,
   `win_rate`; new `NightStats` / `TeamNightRecord` models;
   `RankingsResponse` += optional `night`, `highlights` (both nullable —
   season-scoped responses keep the old shape where `night` is absent).
7. `get_user_metrics` — passes the new fields through unchanged; extend
   `UserStats` (`app/schemas/stats.py`) and `get_user_statistics`
   (`app/services/stats_service.py`) with `wins`, `matches`, `win_rate`
   (all-time + season) — the profile already renders `UserStats`, so this is
   fields, not a new surface.
8. Personal per-meetup stats — extend `GET /users/{user_id}/history`
   (`admin_get_player_history` in `app/api/users.py`):
   - Access: `require_admin` → **admin OR self** (`user_id == current
     user.id`); other users' history stays admin-only.
   - Each history row gains the player's per-meetup metrics
     `{matches, wins, goals, assists, clean_sheets, goals_conceded}` —
     computed in one batch for the page's meetup ids: `_load_scope` gains an
     optional `meetup_ids: list[int]` filter, and per-meetup metrics come
     from grouping the scoped matches/goals by `meetup_id`. No per-row
     queries.

Router (`app/api/rankings.py`): no signature changes — both endpoints keep
their contracts, the envelopes just carry the extra blocks.

## 5. Frontend

Design system: existing tokens only (`bg-panel`, `bg-raised`, `border-line`,
`text-ink*`, `text-live`, `bg-board`, `text-team-a` / `text-team-b`). The
reference's per-team color-coding collapses to those two tokens for the first
two teams, neutral ink for the rest (meetups can have up to 5 teams).

1. `api/rankingsApi.ts` — extend `RankingRow` and `RankingsResponse` types to
   mirror the schemas.
2. `components/RankingsTable.tsx` — desktop columns += **Wins** and **Win %**
   (after Assists); mobile tabs += **Wins**. Attendances column is the
   reference's "M". Nothing else changes; the history page picks the columns
   up for free.
3. `pages/RankingsPage.tsx` — "Season highlights" card above the table: six
   compact rows (`GOALS — Top · N · Runner-up · N`), rendered from
   `highlights`; hidden when empty.
4. `pages/HistoryMeetupPage.tsx` — two new sections before "Top performers":
   - **Night KPIs**: a 4-tile row (Matches, Goals, Players, One-goal wins)
     in the existing `StatCard`-style grid (2×2 on mobile).
   - **The teams**: one bordered card per team record — `W wins / M`,
     `GF – GA · GD ±n`, clean sheets, roster names (wrapping list). Cards in
     server order.
   - The per-match list with scorers already exists:
     `MeetupDetailPanel` → `MatchHistoryList` (expanded rows show the
     `GoalList` scorers, final rosters and the substitution log). No change.
5. `api/meApi.ts` + `pages/ProfilePage.tsx` — the profile page focuses on
   the **current player's own stats and attendance history**:
   - **Stats grid**: extend the `UserStats` type and the existing tile grid
     with **Season wins** and **Season win %** (alongside the existing
     season goals/assists tiles). The grid is the personal season summary —
     matches, wins, win %, goals, assists, clean sheets, goals conceded —
     all from `UserStats` season fields; no second stats source.
   - **Attendance history (new section, paginated)**: calls
     `GET /users/me/history` (the extended admin endpoint, self-scoped) and
     renders a dated list (date desc, 25/page, prev/next like the rankings
     page). Each row: date, location, link to the meetup history page, and
     the row's per-meetup metric chips (`G n · A n · W n` — goals, assists,
     wins; zero-activity rows show plain). Attendance status shown as today
     (confirmed/waitlist/etc.).

## 6. Tests

- `app/tests/test_live_scoring.py` (or `test_rankings.py`): `end_match`
  persists `winner_team` — decisive result derived from scores, tie taken
  from `body.winner_team`; the additive migration fires on an old-schema DB.
- `app/tests/test_rankings.py`:
  - wins crediting: only the final winning roster; a draw (tied score, null
    `winner_team`) credits no wins; swapped-out player (absent from final
    roster) gets no win; legacy rows (null `winner_team`, decisive score)
    fall back to the score columns.
  - `win_rate` / `goal_assists` sorting, including the tie-break order.
  - night block: KPIs (one-goal-win count), team record
    (wins / GF / GA / GD / clean sheets / union roster), team ordering.
  - highlights: top-3 truncation, win-rate 2+ matches threshold, empty-scope
    safety.
- `app/tests/test_player_history.py`:
  - extended `UserStats` key set (all-time + season wins / matches /
    win_rate).
  - self access: a non-admin can fetch `GET /users/me/history` for
    themselves, gets 403/404 for another player; admin access unchanged.
  - history rows carry the per-meetup metrics and they match the
    meetup-scoped rankings for the same player.
- Frontend: `npm run lint` + build (no new component tests, matching the
  existing state of the rankings surface).

## 7. Out of scope

- The `GameTemplate.allows_draws` toggle itself (enabling true draws,
  end-match UI for a standing tie, next-matchup selection without a winner) —
  a separate change; stats already handle the resulting draw rows (tied
  score + null `winner_team`).
- The reference's "draw goes to the fresh team" rule (its stay-on/fresh
  format).
- Per-player night swap-path labels ("B → C") — covered by the existing
  per-match substitution log in `MatchHistoryList`.
- Goals/assists bar charts — the per-player table carries the same numbers;
  a chart is presentation, not reporting.
- Mid-match (in-game) line changes — swaps are pre-match in this codebase.

## 8. Order of work

1. `MeetupMatch.winner_team`: model + migration + `end_match` persistence.
2. Service: `wins` / `matches` in `_aggregate`, sortable columns, `night`
   block, `highlights` — with backend tests.
3. Schemas + router envelope plumbing.
4. `UserStats` / `get_user_statistics` + `GET /users/{id}/history`
   self-access + per-meetup row metrics.
5. Frontend: `rankingsApi` types + `RankingsTable` columns +
   `RankingsPage` highlights card.
6. `HistoryMeetupPage` KPI tiles + team cards.
7. `ProfilePage` season tiles + paginated attendance history.
