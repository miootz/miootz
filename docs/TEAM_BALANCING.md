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
2. **Order the players.** Balanced mode sorts highest skill first. Tied players
   retain their order from the roster query, which has no explicit tie-breaker.
   Random mode shuffles the full roster.
3. **Deal in alternating directions.** With three teams, the draft goes
   1 → 2 → 3, then 3 → 2 → 1. A full team is skipped. Each new random draft
   can differ until an admin saves a lineup.

The draft spreads skill by order. Team totals can still vary, and positions
such as goalkeeper are display information. The meetup's minimum attendance
setting has no effect on the draft. See the
[assignment code](../app/services/team_assignment.py).

## How overall skill is calculated

The balanced draft uses overall skill, a combination of peer ratings, a
permanent seed set by an admin or import, and five attributes:

| Input | Share |
| --- | ---: |
| Recency-weighted peer ratings | 55% |
| Admin or imported seed | 25% |
| Shooting (SHO) | 6% |
| Passing (PAS) | 5% |
| Defense (DEF) | 5% |
| Pace (PAC), set by an admin | 2% |
| Dribbling (DRI), set by an admin | 2% |

Peer ratings and the seed form a baseline. When both exist, they are averaged
in the ratio 55:25. If only one exists, it is the baseline. Each unavailable
attribute's share returns to that baseline. If neither peer ratings nor a seed
exists, the player has no overall skill, even if attributes are available.

For example, a peer average of 4.0 and a seed of 3.0 give a baseline of
`(55 × 4.0 + 25 × 3.0) ÷ 80 = 3.6875`. If SHO is the only available
attribute and is 4.0, the other attribute shares return to the baseline, giving
`3.6875 × 0.94 + 4.0 × 0.06 = 3.70625` before attendance decay and rounding.

### Peer ratings and attendance

| Rating's meetup | Weight per rating |
| --- | --- |
| One of the player's four most recently joined confirmed meetups, ordered by signup time | 1.0 |
| Any other meetup | 0.5 |

Scores from **1 to 5** count. Multiply each score by its weight, add the
results, and divide by the sum of the weights. A skipped or cleared rating
contributes nothing. Older ratings retain half weight.

**Attendance decay.** Miootz counts consecutive meetups without confirmed
attendance, looking at up to 20 past meetups the skill calculation treats as
closed. It stops at the first confirmed attendance. The first miss is free.
Each further consecutive miss subtracts **0.1**, up to **1.0** in total. The
deduction is applied once when valid peer ratings exist. The final overall
skill is limited to **0–5** and rounded to one decimal place.

**Example.** A recent 5 and an older 3 give a weighted average of
`(5 × 1 + 3 × 0.5) ÷ 1.5 = 4.33…` as the peer-rating input. Three consecutive
misses cause a deduction of 0.2 from the combined skill.

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

Miootz converts each rate to a 1–5 attribute by interpolating between its
anchors, caps the result at 1–5, and rounds it to one decimal place. Rankings'
**Attributes** view shows SHO, PAS, and DEF for the selected period and can
sort by each. History shows the underlying goals, assists, clean sheets, and
assist coverage. The profile shows current attributes and overall skill;
admins can set PAC and DRI.

Fresh databases work without migrating the former additive match bonus.
Attributes use eligible recorded or imported match history.

## How admins adjust teams

| Control | What happens |
| --- | --- |
| **Team assignment** | Choose balanced or random for a meetup. Recurring meetups inherit the template setting. Saving meetup details in the admin form clears the saved lineup, even when the mode is the same. |
| **Drag and save** | Every confirmed player must appear once. With no cap, sizes must match the draft. With a cap, the lineup needs that number of teams, plus an optional bench team of any size. |
| **Lock and reshuffle** | Locked players keep their team and team sizes stay fixed. Balanced reshuffles randomize equal-skill players before dealing. Random reshuffles shuffle all unlocked players. Locks are local, and the preview uses the default team-count rule and skill order. The server saves a changed lineup. |
| **Change team capacity** | Adding capacity promotes the earliest waitlisted players into free places, up to five per capped team. Reducing it waitlists the latest excess signups. Both clear the saved lineup and redraft. |
| **Reshape during play** | Choose a team count and size. The draft includes a bench team for excess players. Pending matches receive the new first two teams. Live and completed matches keep their recorded lineups. |

If attendance changes, an invalid saved lineup is ignored. It can take effect
again if the same confirmed roster returns. A pre-start substitution updates
the lineup for future rounds. A substitution during play updates that match.

The Teams panel labels a spread of 2 or less between the highest and lowest
team totals **Balanced** and a larger spread **Uneven**. A reshuffle that
returns the exact same lineup says **Already balanced**.

[Saved lineups](../app/services/manual_teams.py) ·
[Capacity changes](../app/services/team_adjustment.py) ·
[Teams panel](../frontend/src/components/MeetupTeamsPanel.tsx)
