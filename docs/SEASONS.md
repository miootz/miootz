# Seasons and rankings

When players tie on a rankings statistic or attribute, the higher active
rating comes first. The admin rating setting selects Base or Adjusted Rating.
Ties in the Rating column use Shooting, then Passing, then Defending, each
in descending order when those scores are available.

A season is a UTC calendar year. Miootz calculates season statistics from the
stored history; starting a new year does not delete or rewrite past data.
The rankings page also offers an all-time view.

Rankings include players with confirmed attendance in the selected period.
Attendance is assigned to the year of the meetup's start time; match statistics
are assigned to the year the match was completed. Only completed matches and
non-deleted goals contribute to match statistics.

Goals, assists and goals conceded are credited to the players recorded on each
goal. Scored regulation penalties count toward the match score. Rankings and
Profile Progress track penalty attempts and conversion separately from player
goal totals. Season rankings exclude own goals by default; the user can include them.
A clean sheet is credited to eligible members of a team that conceded no goals.
For matches with recorded timed substitutions, the player must have played at
least half the match to receive match-based credit.

Wins go to the winner of a decided shootout; otherwise they go to the higher
scoring team. When scores are tied, the away team advances and receives the win,
including when the match is also recorded as a draw. Penalty totals include
recorded regulation penalty goals, regulation penalty misses, and shootout kicks.
Conversion is the share of those recorded attempts that scored.

Authenticated clients can request:

- `GET /rankings`: current season by default; `year=YYYY` selects a year and
  `year=all` selects all time. It supports sorting, pagination and
  `include_own_goals`.
- `GET /meetups/{meetup_id}/rankings`: rankings and team summaries for one
  meetup, including own goals. It returns 404 when there are no completed
  matches.

See `app/services/rankings_service.py` for the calculation rules and
`app/api/rankings.py` for accepted request parameters.

## Stored summaries and player progress

Miootz builds SQLite summaries for finished meetups when Rankings or Profile
needs them. Each summary contains additive player counts and unweighted
shooting, passing and defending evidence. A score correction, attendance
change, import or other edit to the source rows clears the affected summary.
The next read rebuilds it. Upcoming and in-progress meetups keep using current
records, and Rankings use the current Base or Adjusted Rating for sorting.

Season totals use the meetup kickoff year for attendance and the match
completion year for match statistics. Rates are calculated from the summed
counts. Attributes apply the existing recency weights and evidence thresholds
after combining the selected meetups.

Profile → Progress defaults to the last eight played meetups. The season
view groups the current year's meetups by kickoff date. Attack shows goals and recorded assists.
Results shows wins and clean sheets against matches played. The Rating view
shows the player's current ratings at their latest played meetup in the recent
or current-season view until a saved rating is available. Adjusted Rating
includes match attributes even without peer votes. The scheduler captures
ratings after the next kickoff closes the review window. Earlier meetups
without a saved rating have no rating point.
The demo includes fictional rating points so the chart can be tested locally.
