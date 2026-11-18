# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Adults on a friendly-competitive amateur football (soccer) squad, using the app from a phone at the venue — hall, bench, pitchside — in the minutes before kickoff and during the match. Their job: who's on, who's off, which team they're on, what the score is, and rating teammates after the game. Organizers are usually also players; organizers who never play are not a separate primary audience (confirmed 2026-10).

## Product Purpose

Miootz is the squad's own tool for running recurring meetups and the matches inside them: signup with a waitlist, balanced team assignment, a live goal sheet for the referee, post-match peer ratings, and web-push notifications. Success means the squad checks it at the venue and it's right at a glance — no admin needed mid-flow.

## Positioning

Self-hostable and passkey-only: the squad owns the instance (Docker + Traefik), members sign in with Pocket ID passkeys, and notifications use web push rather than email.

## Operating Context

- Typical scene: weekly hall football; players confirm from a phone in the parking lot or on the bench; the referee logs goals from the pitch with gloves on.
- Rhythm: weekly recurring meetups driven by a schedule template; kickoff countdown, venue + map + weather are pre-match context.
- Flows that must work hands-busy: join/leave, team assignment (drag rows), goal entry (a leased sheet so two people don't log at once), ratings before the lock at next kickoff.
- Onboarding: an invite link (web push notification or shared URL) → Pocket ID passkey → the user is in. No email confirmation step.
- Plus-one: a confirmed player reserves a guest spot; the guest claims it via link and takes the placeholder's place.

## Capabilities and Constraints

- Confirmed: signup/leave with capacity and waitlist, skill-based team balance, live match timer + goal entry with lease, peer ratings locked at next kickoff, chat, weather and map per meetup, history of past meetups and matches, admin console (meetups, sessions, attendance, teams, weekly game templates, user roster, invites), web-push notifications (VAPID), installable web app, offline banner.
- Constraints: Pocket ID is the only identity (RS256 JWT, JWKS); web push is the only notification channel — nothing in this stack sends email; SQLite backend; self-hosted Docker deployment with parameterized hosts.
- Terminology: a **meetup** is the scheduled gathering; a **match** is a game inside it. **Plus-one** is a reserved guest spot. **Lease** is the short lock that keeps one person logging goals.

## Brand Commitments

- Name: Miootz.
- Voice: "The Home Locker Room" — no-nonsense, zero hype, the ambience is fluorescent hall light; the interface says exactly what it means and never plays cool. Confirmed binding by the user (2026-10).
- Licenses: MIT.

## Evidence on Hand

- Runnable demo with six seeded scenarios and sample accounts (`docs/DEMO.md`, `app.demo`), including a live-match rehearsal at 2–1.
- Demo data is fictional. Do not invent customer testimonials or usage claims.

## Product Principles

1. **Rightness over atmosphere.** Accurate data and glanceable status beat mood; a screen that's pretty but not instantly correct failed.
2. **The UI explains itself.** Layout, labels, states, and controls are the documentation; narrative helper copy and subheaders are the exception, not the norm.
3. **Own the instance.** Self-hostable, passkey-only, email-free — the squad's data and identity never route through a vendor login.
4. **Built for the venue.** It is used on a phone, near a pitch, possibly one-handed and gloved; friction and fiddliness are defects.
5. **Zero-friction onboarding.** Invite link to passkey to playing, with no account forms and no email step.

## Accessibility & Inclusion

Standard web accessibility is the bar: real heading structure, labelled controls, 4.5:1 text contrast in light and dark themes, `motion-safe`/`motion-reduce` pairs on all animation, and minimum 44px touch targets because the primary use is a phone at the venue.
