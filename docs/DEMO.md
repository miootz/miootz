# Miootz demo

## Hosted demo

Visitors share one temporary SQLite database. Sign in from separate devices
or browser profiles to test together. Tabs in one browser profile share the
same sign-in state.

Signing in preserves shared progress. The API resets the game data every
hour from startup, and restarting the API starts a fresh database. The
scenario picker selects the fixtures for the next reset. If you have a page
open during a reset, reload it to see the new fixtures.

See the [deployment guide](DEPLOYMENT.md) to host this demo.

## Local demo

Install Python and frontend dependencies, then run from the repository root:

```sh
uv sync
npm ci --prefix frontend
uv run python -m app.demo --scenario full
```

Open [the demo account menu](http://127.0.0.1:5180/api/demo). Select an account; no passkey is needed. Both servers bind to `127.0.0.1`. The API uses port 8010 and the frontend uses 5180, leaving the normal development ports free. Override with `--api-port` and `--frontend-port` if needed.

Stop with Ctrl+C. Selecting an account resets the selected scenario to its initial state. Each run creates a fresh temporary SQLite database; it never seeds or resets `data/miootz.db`, Pocket ID, or any existing account. The temporary database is removed on normal shutdown. The account menu is available only in this separate demo entrypoint, not in the production application.

## In a container

The same entrypoint can be served from a container behind the dev stack's Traefik + mkcert TLS (no Pocket ID; the API stays same-origin under `/api` via Vite's proxy):

```sh
docker compose --env-file .env.dev -f docker-compose.demo.yml up -d --build
# pick a scenario:
DEMO_SCENARIO=live docker compose --env-file .env.dev -f docker-compose.demo.yml up -d
```

App: [https://app.miootz.local:8443](https://app.miootz.local:8443) — account menu at `/api/demo`. `DEMO_BIND_HOST`, `DEMO_TRUSTED_HOSTS` and `DEMO_PUBLIC_APP_URL` let the entrypoint bind beyond loopback and trust the proxy `Host` header (defaults keep the loopback behavior). It is mutually exclusive with the dev stack: both own `:8443`. `docker compose down` (same flags) stops it; restarting the container resets the scenario.

## Scenarios

| Argument | Initial member screen | Suggested demonstration |
|---|---|---|
| `open` | 12 confirmed, three places available | Join as Newcomer; leave and rejoin; view balanced teams |
| `full` | 15 confirmed, three waitlisted | Open Waitlisted to see position #2; leave as Member to promote the first waiting player |
| `broadcast` | 15 confirmed, three waitlisted; broadcast policy | Leave as Member to open a place. Actual notification delivery is disabled |
| `random` | 12 confirmed, saved random lineups | Open Admin → Meetups → next meetup → Teams to reshuffle |
| `live` | Meetup started 20 min ago, active match, score 2–1 | View the member live banner and the Referee match controls. Timer starts paused at 6:42; resume it to demonstrate timing |
| `kickoff` | 16 confirmed, first match ready | Try the referee and match controls when a meetup starts |

The live scenario seeds the meetup as having started 20 minutes before the run began, so the presence window (T-15 min head) and the overview's results mode are open and the Referee view accepts scoring.

All scenarios include the same fictional roster, venue, chat, weekly template, a pending guest reservation, three past meetups and 18 completed matches. The `live` scenario adds an active match and `kickoff` adds a pending match. Ratings for the latest past meetup are editable until the next kickoff. Dates are relative to launch. The `seed_demo` function accepts an explicit UTC anchor for automated tests and refuses nonempty databases.

## Accounts and useful routes

Return to `/api/demo` to switch accounts. In the local demo, signing in resets
the selected scenario for all users. In the hosted demo, switching accounts
keeps the current game data. Demo sign-ins last 12 hours.

| Account | Purpose |
|---|---|
| Admin | Admin overview, sessions, attendance, team editing, weekly template and user roster; also has playing history |
| Member | Confirmed player, plus-one host, three past attendances, editable ratings, chat notifications disabled |
| Waitlisted | Second in the queue in `full` and `broadcast` |
| Newcomer | Not attending; can join or enter the queue; opted out of weekly template notifications |
| Guest | Claims a pending plus-one reservation, transferring the placeholder's place to this account |

| Route | Screen |
|---|---|
| `/` | Upcoming member meetup (admins initially go to `/admin`) |
| `/profile` | Personal statistics, skill, notification preferences and weekly subscription |
| `/history` | Three populated past meetups |
| `/history/2` | Recent results and editable peer ratings for Member |
| `/admin` | Organizer overview |
| `/admin/meetups/1` | Upcoming details, attendance and team management |
| `/admin/game-templates/1` | Weekly schedule |
| `/admin/players` | Fictional roster, including an unlinked member |
| `/meetup-matches/1` | Referee timer and score controls, especially in `live` |

## Phone screenshot checklist

Use a 390 × 844 viewport. Select the light theme consistently. Dismiss onboarding/install/notification overlays through the app before capturing clean screenshots; leave them visible only when documenting onboarding itself.

1. `full` / Member: meetup header and team roster; scroll separately for chat and map.
2. `full` / Waitlisted: waitlist position.
3. `full` / Admin: overview, attendance tab and teams tab.
4. Admin: weekly template edit screen.
5. Member: `/history/2` results and rating controls; `/profile` statistics.
6. Guest: reservation details, then successful claim. Restart afterward to restore the pending state.
7. `live`: member live banner and admin match controls.
8. `open` / Newcomer: join action and confirmed result.

## What the isolated demo does not prove

- Authentication is adapted only in the demo server, using random, short-lived local tokens. Real Pocket ID/passkey login and new-account onboarding still require the real stack. New guests in the real app need a member account invitation before claiming a reservation.
- Account invitation generation and Pocket ID account deletion are unavailable by default. `--simulate-invites` enables the real admin UI with a simulated token response and a reserved `.example` URL; the demo menu states this clearly. These links do not create real Pocket ID accounts. Do not present that response as a verified Pocket ID integration.
- By default VAPID keys are cleared and push delivery is disabled. Pass `--enable-push` to build a production-mode demo with temporary VAPID keys. Register a test device as the Newcomer, then send the test invite from the demo menu. This sends only to that sample account. Installed web apps start at the demo account chooser because their browser storage is separate. Notification delivery and tap-through still require device verification; a successful send alone is not proof of display.
- The scheduler is disabled, so weekly jobs do not run on their own. The weekly template form and its saved settings are real.
- Weather is a fixed sample, not a forecast. The venue is fictional; map tiles are still fetched from the normal map provider.
- The data is fictional and must not be presented as evidence of real users or endorsements.
