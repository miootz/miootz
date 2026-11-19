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
goal. Season rankings exclude own goals by default; the user can include them.
A clean sheet is credited to eligible members of a team that conceded no goals.
For matches with recorded timed substitutions, the player must have played at
least half the match to receive match-based credit.

Wins go to the winner of a decided shootout; otherwise they go to the higher
scoring team. When scores are tied, the away team advances and receives the win,
including when the match is also recorded as a draw. Penalty totals include
recorded in-game penalty goals and shootout kicks.

Authenticated clients can request:

- `GET /rankings`: current season by default; `year=YYYY` selects a year and
  `year=all` selects all time. It supports sorting, pagination and
  `include_own_goals`.
- `GET /meetups/{meetup_id}/rankings`: rankings and team summaries for one
  meetup, including own goals. It returns 404 when there are no completed
  matches.

See `app/services/rankings_service.py` for the calculation rules and
`app/api/rankings.py` for accepted request parameters.
