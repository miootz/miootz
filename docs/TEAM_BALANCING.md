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

## How peer ratings affect skill

The balanced draft uses the player's stored skill. An admin can set the
initial value. With at least one valid peer rating, the skill before any match
bonus is the weighted peer average minus attendance decay.

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
Each further consecutive miss subtracts **0.1**, up to **1.0** in total.
After adding any match bonus, Miootz limits the result to **0–5** and rounds
it to one decimal place.

**Example.** A recent 5 and an older 3 give a weighted average of
`(5 × 1 + 3 × 0.5) ÷ 1.5 = 4.33…`. Three consecutive misses subtract 0.2,
leaving a skill of **4.1** before any match bonus.

Adding, editing, or clearing a peer rating recalculates skill, as can changes
to attendance. If there are no valid ratings left, Miootz keeps the last
skill before the match bonus. Players who have never had a skill rating
stay unrated. [Skill calculation](../app/services/skill_service.py) ·
[Rating updates](../app/api/ratings.py)

**Missing skill.** Team drafts use **3.0** for an unrated player. An actual
**0.0** remains zero.

## How match performance affects skill

| Event in a completed match | Bonus points |
| --- | ---: |
| Goal | +0.30 |
| Assist | +0.20 |
| Clean sheet | +0.10 |

Own goals and shootout kicks earn no bonus. A clean sheet follows the same
eligibility rules as Rankings. Each player's total is capped at **0.60 per
match**.

Every match played counts, including appearances without a goal, assist or
clean sheet. A match's weight halves every **three weeks**, measured from
its meetup's kickoff to the most recent meetup's scheduled end. Miootz
divides the weighted bonus points by the total match weight plus **3**,
equivalent to three fresh matches with no bonus.
For example, a fresh match with one goal and a clean sheet contributes
`(0.30 + 0.10) ÷ (1 + 3) = 0.10` to a player with no other matches.

The bonus refreshes at the scheduled end of a meetup, after late match
completion, and after historical match corrections or imports. The scheduled
end defaults to two hours after kickoff. Between these updates, peer ratings
and attendance changes use the last calculated bonus.

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
