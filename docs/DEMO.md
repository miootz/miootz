# Miootz demo

## Hosted demo

Open the demo home page, choose a scenario, then choose a sample account.
Both rooms run at the same time and keep separate game data.

| Room | Starting point | Try this together |
| --- | --- | --- |
| **Squad setup** | One spot left at a future meetup | Join as Newcomer to fill the meetup, then join as Second newcomer to enter the waitlist. Use Admin to manage teams or change the waitlist policy. |
| **Matchday** | The first match is ready for kickoff | As Admin, open **Start matches** and start the timer. As Member, keep the meetup open to follow the score and clock live. |

Share the room's account chooser link with someone who wants to test alongside
you. Use separate browser profiles or devices to sign in as two roles in the
same room. Use **All scenarios** to switch rooms. You can keep different rooms
open in the same browser.

Each room resets after 60 minutes without activity. Sign-ins and interactions
keep that room active. Opening another room preserves the first room's
progress. If a tab was idle during a reset, reload it to see the fresh fixtures.
Restarting a room also starts it with fresh data.

See the [deployment guide](DEPLOYMENT.md) to host this demo.

## Run both rooms locally

Use the hosted images with the loopback-only Compose override.

```sh
APP_DOMAIN=example.test docker compose -p miootz-demo-local \
  -f docker-compose.demo-hosted.yml -f docker-compose.demo-local.yml up -d --build
```

Open [the room picker](http://127.0.0.1:5180/). Set `DEMO_LOCAL_PORT` if
port 5180 is in use. Stop the demo with the same environment and Compose
flags, replacing `up -d --build` with `down`.

## Local fixture preview

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

## Local scenarios

| Argument | Initial member screen | Suggested demonstration |
|---|---|---|
| `open` | 12 confirmed, three places available | Join as Newcomer; leave and rejoin; view balanced teams |
| `full` | 15 confirmed, three waitlisted | Open Waitlisted to see position #2; leave as Member to promote the first waiting player |
| `broadcast` | 15 confirmed, three waitlisted; broadcast policy | Leave as Member to open a place. Actual notification delivery is disabled |
| `random` | 12 confirmed, saved random lineups | Open Admin → Meetups → next meetup → Teams to reshuffle |
| `live` | Meetup started 20 min ago, active match, score 2–1 | View the member live banner and the Referee match controls. Timer starts paused at 6:42; resume it to demonstrate timing |
| `kickoff` | 16 confirmed, first match ready | Try the referee and match controls when a meetup starts |

The live scenario seeds the meetup as having started 20 minutes before the run began, so the presence window (T-15 min head) and the overview's results mode are open and the Referee view accepts scoring.

All scenarios include sample accounts named after famous footballers, a fictional venue and chat, a weekly template, a pending guest reservation, three past meetups and 18 completed matches. The `live` scenario adds an active match and `kickoff` adds a pending match. Ratings for the latest past meetup are editable until the next kickoff. Dates are relative to launch. The `seed_demo` function accepts an explicit UTC anchor for automated tests and refuses nonempty databases.

## Accounts and useful routes

The local fixture preview's account menu is at `/api/demo`. Signing in there
resets its selected scenario. In the hosted demo, use `/squad/api/demo` or
`/matchday/api/demo` to switch accounts and keep the room's game data. The
routes below are relative to the room or standalone preview. Demo sign-ins
last 12 hours.

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
| `/profile` | Base and Adjusted Rating, attributes, statistics, notifications, and weekly subscription |
| `/rankings` | Match stats and the Ratings view |
| `/history` | Three populated past meetups |
| `/history/2` | Recent results and editable peer ratings for Member |
| `/admin` | Organizer overview |
| `/admin/meetups/1` | Upcoming details, attendance and team management |
| `/admin/game-templates/1` | Weekly schedule |
| `/admin/players` | Demo accounts named after historical players, including an unlinked member |
| `/meetup-matches/1` | Referee timer and score controls, especially in `live` |

## Demo ratings

The demo uses EA SPORTS FC 26 **base Icon** card values where available.
EA's public site describes the Icons, and the card figures come from the
FUT.GG and WeFUT indexes. Michel Platini and Alfredo Di Stéfano have no
verified card in those sources, so they have no imported Base Rating, PAC,
or DRI. Goalkeepers use their card's Speed for PAC. Their DRI is unset.
[EA SPORTS FC 26 Icons](https://www.ea.com/games/ea-sports-fc/fc-26/features/fc-26-icons) ·
[FUT.GG base Icon example](https://www.fut.gg/players/190045-johan-cruyff/26-190045/) ·
[WeFUT Icon index](https://static.wefut.com/league/2118/26/any)

Convert the card value with `(value − 40) ÷ 12` and limit it to **1–5**.
Overall rounds to one decimal for Base Rating. PAC and DRI round down to half
stars so players such as Johan Cruyff and George Best have **4.0 in both**.
Shooting, Passing, and Defending still come from logged demo matches. Card
attributes influence the synthetic match events so those ratings vary.

New demo rooms start with **Teammates only**. Historical votes vary by
player and meetup. The Member has no outgoing votes in the latest meetup,
so you can try the four emoji reviews at `/history/2` in the Squad room. Paolo
Maldini has fewer than three reviewers per past meetup at seed time, so
those votes cannot affect his Adjusted Rating. [Rating settings](RATINGS.md)

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
- Hosted rooms replay queued actions in the foreground and keep browser storage separate by room. To test real push delivery, run the standalone preview with `--enable-push` and temporary VAPID keys. Register a test device as the Newcomer, then send the test invite from the demo menu. This sends only to that sample account. Installed preview apps open their account chooser. Verify delivery and tap-through on the test device.
- The scheduler is disabled, so weekly jobs do not run on their own. The weekly template form and its saved settings are real.
- Weather is a fixed sample, not a forecast. The venue is fictional; map tiles are still fetched from the normal map provider.
- The data is fictional and must not be presented as evidence of real users or endorsements.
