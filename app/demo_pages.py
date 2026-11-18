"""Public pages for choosing a demo room and signing in to it."""

from html import escape


ROOMS = {
    "squad": (
        "Squad setup",
        "One place left at the next meetup",
        (
            "Take the last spot, then use a second account to join the waitlist.",
            "Try a plus-one, rearrange lineups, or change the waitlist policy as an admin.",
        ),
    ),
    "matchday": (
        "Matchday",
        "The first match is ready for kickoff",
        (
            "Start the timer as an admin, then pause it, log goals, or make substitutions.",
            "Open the same room as a player to follow the scoreboard live.",
        ),
    ),
}

_SQUAD_ROLES = {
    "newcomer": ("Newcomer", "Take the last available spot."),
    "waitlisted": ("Second newcomer", "Join after the last spot fills to try the waitlist."),
    "member": ("Member", "You already have a place. Try chat, leaving, or managing your plus-one."),
    "admin": ("Admin", "Manage attendance, teams, and the waitlist."),
    "guest": ("Guest", "Open the sample plus-one invitation."),
}
_MATCHDAY_ROLES = {
    "admin": ("Admin", "Open Match Control and start the prepared match."),
    "member": ("Member", "Follow the score and clock from the meetup screen."),
}

_STYLE = """
@font-face{font-family:Archivo;src:url('/demo-archivo.woff2') format('woff2');font-weight:100 900;font-display:swap}
:root{color-scheme:dark;--board:#0b1220;--panel:#101826;--raised:#182238;
  --line:#32415a;--ink:#f8fafc;--muted:#aab8cb;--amber:#f59e0b;--green:#86d79a}
*{box-sizing:border-box}
body{margin:0;background:var(--board);color:var(--ink);font:1rem/1.5 Archivo,system-ui,sans-serif}
::selection{background:var(--amber);color:var(--board)}
a{color:inherit;text-underline-offset:.22em}
a:focus-visible,button:focus-visible{outline:2px solid var(--amber);outline-offset:4px}
main{width:min(100% - 2rem, 60rem);margin-inline:auto;padding-block:clamp(2rem,7vw,5rem)}
.account-page{width:min(100% - 2rem, 42rem)}
header{border-bottom:1px solid var(--line);padding-block-end:1.4rem;margin-block-end:1.8rem}
h1,h2,h3,p{margin:0}
h1{font-size:clamp(1.5rem,7vw,3rem);font-weight:850;line-height:1.05;letter-spacing:-.03em}
h2{font-size:1.125rem;font-weight:750;margin-block-end:.8rem}
h3{font-size:1.5rem;line-height:1.2;letter-spacing:-.02em}
.intro{color:var(--muted);max-width:62ch;margin-block-start:.65rem}
.scenarios{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));gap:1rem}
.scenario{position:relative;min-width:0;background:var(--panel);border:1px solid var(--line);
  border-top:3px solid var(--room-accent,var(--green));padding:clamp(1.1rem,4vw,1.65rem)}
.scenario:last-child{--room-accent:var(--amber)}
.scenario:hover,.scenario:focus-within{background:var(--raised)}
.scenario a::after{content:"";position:absolute;inset:0}
.scenario a{display:inline-flex;align-items:center;min-height:44px}
.starting-point{margin-block:.4rem .65rem;color:var(--room-accent,var(--green));font-weight:680}
.scenario ul{padding-inline-start:1.2rem;margin:0;color:var(--muted)}
.scenario li + li{margin-block-start:.45rem}
.reset-note{max-width:65ch;margin-block-start:1.35rem;color:var(--muted);font-size:.9rem}
.back{display:inline-flex;align-items:center;min-height:44px;margin-block-end:.8rem;color:var(--muted)}
.accounts{display:grid;gap:.55rem}
.accounts button{display:grid;gap:.2rem;min-height:44px;width:100%;padding:.8rem 1rem;
  border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;text-align:start;cursor:pointer}
.accounts button:hover{background:var(--raised);border-color:var(--muted)}
.role{display:flex;flex-wrap:wrap;gap:.2rem .8rem;align-items:baseline}
.role strong{font-weight:750}
.role-name,.role-detail{color:var(--muted);font-size:.9rem}
"""


def _page(title: str, content: str, *, account_page: bool = False) -> str:
    page_class = ' class="account-page"' if account_page else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <style>{_STYLE}</style>
</head>
<body><main{page_class}>{content}</main></body>
</html>"""


def render_lobby() -> str:
    scenes = []
    for slug, (name, starting_point, activities) in ROOMS.items():
        bullets = "".join(f"<li>{escape(activity)}</li>" for activity in activities)
        scenes.append(f"""
          <article class="scenario">
            <h3><a href="/{slug}/api/demo">{escape(name)}</a></h3>
            <p class="starting-point">{escape(starting_point)}</p>
            <ul>{bullets}</ul>
          </article>""")
    return _page(
        "Miootz demo",
        f"""
        <header>
          <h1>Miootz demo</h1>
          <p class="intro">Try a football meetup with sample accounts and shared match data.</p>
        </header>
        <h2>Choose a scenario</h2>
        <div class="scenarios">{"".join(scenes)}</div>
        <p class="reset-note">Each room resets after an hour of inactivity.
          Share a room link to test together, or switch rooms at any time.</p>""",
    )


def render_room(
    room: str, accounts: list[tuple[str, str]], remaining_minutes: int
) -> str:
    name, starting_point, _ = ROOMS[room]
    roles = _SQUAD_ROLES if room == "squad" else _MATCHDAY_ROLES
    account_names = dict(accounts)
    buttons = "".join(
        f"""
        <form method="post" action="/{room}/api/demo/login/{role}">
          <button type="submit">
            <span class="role"><strong>{escape(label)}</strong>
              <span class="role-name">{escape(account_names[role])}</span></span>
            <span class="role-detail">{escape(detail)}</span>
          </button>
        </form>"""
        for role, (label, detail) in roles.items()
        if role in account_names
    )
    return _page(
        f"{name} · Miootz demo",
        f"""
        <nav aria-label="Demo"><a class="back" href="/api/demo">All scenarios</a></nav>
        <header>
          <h1>{escape(name)}</h1>
          <p class="intro">{escape(starting_point)} when this room resets.</p>
        </header>
        <h2>Choose an account</h2>
        <div class="accounts">{buttons}</div>
        <p class="reset-note">If nobody uses this room, it resets in about
          {remaining_minutes} min. To use two accounts at once in this room,
          sign in from separate browser profiles.</p>""",
        account_page=True,
    )
