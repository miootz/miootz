# Showcase demo

Run from the repository root with the existing Python environment and frontend dependencies:

```sh
.venv/bin/python -m app.demo --scenario full
```

Open [the demo account menu](http://127.0.0.1:5180/api/demo). Select an account; no passkey is needed. Both servers bind to `127.0.0.1`. The API uses port 8010 and the frontend uses 5180, leaving the normal development ports free. Override with `--api-port` and `--frontend-port` if needed.

Stop with Ctrl+C. Restart to restore the initial state, or choose another scenario. Each run creates a fresh temporary SQLite database; it never seeds or resets `data/miootz.db`, Pocket ID, or any existing account. The temporary database is removed on normal shutdown. The account menu is available only in this separate demo entrypoint, not in the production application.

## Scenarios

| Argument | Initial member screen | Suggested demonstration |
|---|---|---|
| `open` | 12 confirmed, three places available | Join as Newcomer; leave and rejoin; view balanced teams |
| `full` | 15 confirmed, three waitlisted | Open Waitlisted to see position #2; leave as Member to promote the first waiting player |
| `broadcast` | 15 confirmed, three waitlisted; broadcast policy | Leave as Member, then join as Waitlisted to claim the opening. Actual notification delivery is disabled |
| `random` | 12 confirmed, saved random lineups | Open Admin → Sessions → next meetup → Teams to reshuffle |
| `live` | 12 confirmed, active rehearsal match, score 2–1 | View the member live banner and admin match controls. Timer starts paused at 6:42; resume it to demonstrate timing |

The live scenario deliberately rehearses a match before the meetup's scheduled kickoff, so it remains on the existing member home screen. It does not represent a game currently taking place.

All scenarios include the same sample roster using classic footballer names, venue, chat, weekly template, a pending guest reservation, three past meetups and 18 completed matches. The latest past meetup ended two hours before the run began, so its ratings are editable until the next kickoff. Dates are relative to launch; names, attendance, scores and ratings follow fixed rules. The `seed_demo` function accepts an explicit UTC anchor for automated tests and refuses nonempty databases.

## Accounts and useful routes

Return to `/api/demo` to switch accounts in the same tab. Demo tokens expire after 12 hours; use the menu again or restart. Avoid simultaneous different accounts in tabs sharing this origin, because app tokens use localStorage.

| Account | Purpose |
|---|---|
| Admin · Demo Player 01 | Admin overview, sessions, attendance, team editing, weekly template and user roster; also has playing history |
| Member · Demo Player 02 | Confirmed player, plus-one host, three past attendances, editable ratings, chat notifications disabled |
| Waitlisted · Demo Player 17 | Second in the queue in `full` and `broadcast` |
| Newcomer · Demo Player 19 | Not attending; can join or enter the queue; opted out of weekly template notifications |
| Guest · Demo Player 20 | Opens `/plus-one/showcase-guest-reservation`; claim transfers the placeholder's place to this account |

| Route | Screen |
|---|---|
| `/` | Upcoming member meetup (admins initially go to `/admin`) |
| `/profile` | Personal statistics, skill, notification preferences and weekly subscription |
| `/history` | Three populated past meetups |
| `/history/2` | Recent results and editable peer ratings for Member |
| `/admin` | Organizer overview |
| `/admin/sessions/1` | Upcoming details, attendance and team management |
| `/admin/game-templates/1` | Weekly schedule |
| `/admin/users` | Fictional roster, including an unlinked member |
| `/session-matches/1` | Admin timer and score controls, especially in `live` |

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
- By default VAPID keys are cleared and push delivery is disabled. Pass `--enable-push` to build a production-mode demo with temporary VAPID keys. Register a test device in the app, then use “Send test invite to Demo Player 19” in the demo menu. This sends only to that sample account. Installed web apps start at the demo account chooser because their browser storage is separate. Notification delivery and tap-through still require device verification; a successful send alone is not proof of display.
- The scheduler is disabled, so weekly jobs do not run on their own. The weekly template form and its saved settings are real.
- Weather is a fixed sample, not a forecast. The venue is fictional; map tiles are still fetched from the normal map provider.
- No screenshots should imply these footballers are app users or endorse the app.

For the real local stack, `/etc/hosts` provides name resolution but the corresponding services must also be running. The configured app/auth URLs use HTTPS on port 8443. At the time of this audit, 8443 was unavailable and 443 belonged to another service with a different certificate.
