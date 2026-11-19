# Team balancing

Miootz drafts confirmed players, including confirmed plus-ones, when it needs
a lineup. **Balanced (skill snake)** deals players by skill. **Random order
(snake)** shuffles players before dealing. A valid saved lineup takes priority.

## How the draft works

1. **Set the team sizes.** With the defaults, 0 players make 0 teams, 1 makes
   1 team, 2–10 make 2 teams, and 11 or more make 3. With a team cap, divide the
   player count by five, round up, apply the cap, then keep the result between
   two teams and the number of players (one team for a solo player, none for
   an empty roster). Team sizes differ by at most one.
2. **Order the players.** Balanced mode sorts highest active rating first. Tied players
   retain their order from the roster query, which has no explicit tie-breaker.
   Random mode shuffles the full roster.
3. **Deal in alternating directions.** With three teams, the draft goes
   1 → 2 → 3, then 3 → 2 → 1. A full team is skipped. Each new random draft
   can differ until an admin saves a lineup.
4. **Spread pace and dribbling.** In balanced mode, Miootz swaps unlocked
   players across teams when that improves the distribution of players with
   PAC or DRI above 75. It compares each category against each team's share of
   the available playing spots. The bench does not take part in these swaps.
   When two swaps improve the distribution equally, it
   prefers the one that keeps rating totals closer. The roster labels identify
   players above 3.0. This step works with either rating mode.

The draft spreads skill by order. Team totals can still vary, and positions
such as goalkeeper are display information. The meetup's minimum attendance
setting has no effect on the draft. See the
[assignment code](../app/services/team_assignment.py).

## Base Rating and Adjusted Rating

Admins can change the app-wide rating mode under **Admin → Tools → Player
ratings**. With computed scores off, Rankings and balanced drafts use
**Base Rating**, the seed set by an admin or workbook import. With computed
scores on, they use **Adjusted Rating**, which combines the seed, eligible
peer ratings, and five attributes. The profile shows both ratings. Adjusted
Rating is labeled disabled when computation is off. See [Rating settings](RATINGS.md).

| Input | Share |
| --- | ---: |
| Admin or imported seed | 80% |
| Recency-weighted peer adjustment | × 25% |
| Shooting (SHO) | 6% |
| Passing (PAS) | 5% |
| Defense (DEF) | 5% |
| Pace (PAC), set by an admin or seeded by the roster import | 2% |
| Dribbling (DRI), set by an admin | 2% |

Base Rating supplies 80% of the score before peer review and absorbs the
share of any unavailable attribute. The peer adjustment is then added
separately at 25% of the weighted average of the review adjustments. With
qualifying emoji reviews and no Base Rating, Miootz uses 3.0 as the baseline.

Adjusted Rating uses each attribute's internal 1–5 score. The app rounds
its 50–100 display to a whole number after converting the score. Display
rounding does not affect the blend. An admin override entered as a whole
number is converted back with `1 + (override − 50) ÷ 12.5`, so an override
of 90 contributes as 4.2 on the internal scale.

For example, a player with a 3.0 Base Rating, 4.0 Shooting, default PAC
and DRI, and unavailable PAS and DEF has a rating before votes of
`3.0 × 0.94 + 4.0 × 0.06 = 3.06`. A weighted peer adjustment of +0.5
adds 0.125, yielding 3.185 before attendance decay and rounding.

### Peer ratings and attendance

Miootz first averages reviews within each meetup that has at least three
distinct eligible reviewers. Teammates only covers players who shared a
side in a completed match, including substitutes. Everyone lets confirmed
attendees rate one another. Off disables peer voting.

The latest qualifying meetup has weight **1.0**. Each step back through
finished, non-skipped meetups multiplies the weight by **√0.5**. A meetup two
steps back has **half** the weight. An intervening meetup counts as a step
even if it has too few votes to supply an average. Miootz divides the sum of
the weighted meetup averages by the sum of their weights.

When a qualifying emoji review and older star votes both count, Miootz
subtracts Base Rating from each old star vote to put it on the adjustment
scale. A player with only qualifying star votes keeps the previous blend
that weights Base and the peer average in the ratio 55:25.

**Attendance decay.** Miootz counts consecutive meetups without confirmed
attendance, looking at up to 20 past meetups the skill calculation treats as
closed. It stops at the first confirmed attendance. The first miss is free.
Each further consecutive miss subtracts **0.1**, up to **1.0** in total. The
deduction is applied once when valid peer ratings exist. The final overall
skill is limited to **0–5** and rounded to one decimal place.

**Example.** A recent meetup averaging +0.5 and one two steps back averaging
−0.5 give a weighted adjustment of `(0.5 × 1 − 0.5 × 0.5) ÷ 1.5 ≈ 0.17`.
It adds about 0.04 stars to Adjusted Rating before rounding.
Three consecutive misses cause a deduction of 0.2 from Adjusted Rating.

Adding, editing, or clearing a peer rating recalculates skill, as can changes
to attendance. If no valid ratings remain, only the seed can provide the
baseline, and attendance decay does not apply.
[Skill calculation](../app/services/skill_service.py) · [Rating updates](../app/api/ratings.py)

**Missing skill.** Team drafts use **3.0** for an unrated player. An actual
**0.0** remains zero.

## How match attributes are calculated

SHO, PAS, and DEF use completed matches from non-skipped meetups that have
reached their scheduled end. Matches with a timed mid-match substitution are
excluded. For the remaining matches, a player's appearances use the final
team rosters. SHO and PAS also require each team's regulation score to match
its count of active goal records. Open-play goals exclude own goals, regulation
penalties, and shootout kicks. A clean sheet means a player's team conceded no
regulation goals.

Each eligible match is weighted by the time from its meetup's scheduled end to
the latest ended meetup in the requested period. SHO and DEF weights halve
every **21 days**; PAS weights halve every **42 days**. The scheduled end
defaults to two hours after kickoff.

| Attribute | Weighted rate | Minimum evidence | Rate anchors for 1, 3, and 5 |
| --- | --- | --- | --- |
| SHO | (open-play goals + 1.2) ÷ (appearances + 4) | 8 appearances across 3 meetups | 0, 0.30, 0.85 |
| PAS | (player's credited assists + 3) ÷ (team open-play goals with a credited assist + 15) | 8 team open-play goals with a credited assist across 3 meetups, and at least 50% assist coverage | 0, 0.20, 0.45 |
| DEF | (team clean sheets + 2) ÷ (appearances + 8) | 8 appearances across 3 meetups | 0, 0.25, 0.70 |

The counts in each rate are weighted; the minimum-evidence checks use raw
counts. Assist coverage is the share of the player's team open-play goals with
a credited assist. A blank assist counts as an uncredited goal for coverage,
and a match with no team open-play goals provides no PAS scoring evidence.
An attribute stays unavailable until its minimum evidence is met.

Miootz interpolates between the anchors, caps the internal score at 1–5, and
rounds the automatic score to one decimal place. The app displays attributes
as whole numbers on a **50–100** scale using
`round(50 + (internal score − 1) × 12.5)`. Base and Adjusted Rating are measured
in stars. Rankings' **Ratings** view shows SHO, PAS,
and DEF for the selected period and can sort by each. History shows goals,
assists, and clean sheets for the meetup. The profile shows current attributes
and automatic scores' supporting counts.

On a player's admin edit page, admins can override all five attributes on the
50–100 scale. An override replaces the automatic score across periods and in
Adjusted Rating. Clear SHO, PAS, or DEF to use the automatic score again. Clear
PAC or DRI to restore the default of 75, which contributes as 3.0 to Adjusted
Rating. The roster import seeds PAC at 90 for players
marked `Y` in `Runs` who have no PAC value.

Fresh databases work without migrating the former additive match bonus.
Attributes use eligible recorded or imported match history.

## How admins adjust teams

| Control | What happens |
| --- | --- |
| **Team assignment** | Choose balanced or random for a meetup. Recurring meetups inherit the template setting. Saving meetup details in the admin form clears the saved lineup, even when the mode is the same. |
| **Drag and save** | Every confirmed player must appear once. With no cap, sizes must match the draft. With a cap, the lineup needs that number of teams, plus an optional bench team of any size. |
| **Lock and reshuffle** | Locked players keep their team and team sizes stay fixed. Balanced reshuffles randomize equal-rated players before dealing and then spread PAC and DRI among playing teams. Random reshuffles shuffle all unlocked players. Locks are local. The server saves the lineup when an admin reshuffles it. |
| **Team capacity** | Use the cog in Admin Overview or on the Referee page to choose the number of teams and players per team. Before kickoff, increasing capacity confirms the earliest waitlisted players and shrinking it returns the latest excess signups to the waitlist. After a match starts, excess confirmed players stay on the bench. Pending matches receive the new first two teams. Live and completed matches keep their recorded lineups. |

When an admin has set team capacity, later attendance changes keep that team
shape and retain existing player placements where possible. A pre-start
substitution updates the lineup for future rounds. A substitution during play
updates that match.

The Teams panel labels a spread of 2 or less between the highest and lowest
team totals **Balanced** and a larger spread **Uneven**. A reshuffle that
returns the exact same lineup says **Already balanced**.

[Saved lineups](../app/services/manual_teams.py) ·
[Capacity changes](../app/services/team_adjustment.py) ·
[Teams panel](../frontend/src/components/MeetupTeamsPanel.tsx)
