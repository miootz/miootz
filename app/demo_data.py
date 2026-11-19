"""Repeatable, fictional demo fixtures. Seed only an empty, disposable database."""
from datetime import datetime, timedelta
import json
import random

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatMessage
from app.models.game_template import GameTemplate
from app.models.game_template_subscription import GameTemplateSubscription
from app.models.guest_plus_one import GuestPlusOne
from app.models.match import MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.models.user_notification_preference import UserNotificationPreference
from app.services.team_assignment import assign_teams_snake, draft_skill
from app.services.skill_service import refresh_player_skills

SCENARIOS = ('open', 'full', 'broadcast', 'random', 'live', 'kickoff')
ACTORS = {'admin': 1, 'member': 2, 'waitlisted': 17, 'newcomer': 19, 'guest': 20}
NAMES = (
    'Andrea Pirlo', 'Zinedine Zidane', 'Pelé', 'Diego Maradona', 'Paolo Maldini',
    'Franz Beckenbauer', 'Johan Cruyff', 'Gianluigi Buffon', 'Roberto Baggio', 'Xavi Hernández',
    'Ronaldo Nazário', 'Lev Yashin', 'Franco Baresi', 'Michel Platini', 'George Best',
    'Bobby Charlton', 'Garrincha', 'Eusébio', 'Thierry Henry', 'Marco van Basten',
)
POSITIONS = ('MID', 'MID', 'ATT', 'MID', 'DEF', 'DEF', 'ATT', 'GK', 'ATT', 'MID',
             'ATT', 'GK', 'DEF', 'MID', 'ATT', 'MID', 'ATT', 'ATT', 'ATT', 'ATT')
TEAM_NAMES = ['Violet FC', 'Mint United', 'Amber Athletic', 'Blue Rovers']


def team_keeper(roster: list[int]) -> int:
    """Keeper listed for a conceding goal; team 1 has no GK, so fall back to its defender."""
    for specialty in ('GK', 'DEF'):
        for uid in roster:
            if POSITIONS[uid - 1] == specialty:
                return uid
    return roster[0]


async def seed_demo(db: AsyncSession, *, anchor: datetime, scenario: str) -> dict:
    if scenario not in (*SCENARIOS, 'squad'):
        raise ValueError(f'Unknown demo scenario: {scenario}')
    if anchor.tzinfo is not None:
        raise ValueError('Use a naive UTC anchor')
    for model in (User, Meetup, GameTemplate):
        if await db.scalar(select(func.count()).select_from(model)):
            raise ValueError('Demo fixtures require an empty database; existing data is never reset')

    members = [User(
        id=i, pocket_id_sub=f'demo-{i}', sso_display_name=name,
        sso_preferred_username=name.lower().replace(' ', '.'),
        sso_groups=['admins', 'members'] if i == 1 else ['members'], is_admin=i == 1,
        seed_skill=float(2 + i % 4), primary_specialty=POSITIONS[i - 1],
    ) for i, name in enumerate(NAMES, 1)]
    guest_index = ACTORS['guest'] - 1
    members[guest_index].seed_skill = None
    members[1].pac = 4.0
    placeholder = User(
        id=21, pocket_id_sub='demo-placeholder', sso_display_name=NAMES[guest_index],
        seed_skill=3.0, primary_specialty=POSITIONS[guest_index],
    )
    unlinked = User(id=22, sso_display_name='Alfredo Di Stéfano', primary_specialty='ATT')
    db.add_all([*members, placeholder, unlinked])
    await db.flush()

    days_until_friday = (4 - anchor.weekday()) % 7 or 7
    kickoff = (anchor + timedelta(days=days_until_friday)).replace(hour=18, minute=30, second=0, microsecond=0)
    template = GameTemplate(
        id=1, name='Demo football', timezone='UTC', weekday=4,
        hour=18, minute=30, announce_timezone='UTC',
        announce_weekday=3, announce_hour=10, announce_minute=0,
        location='Example Sports Centre', fee=8, fee_text='8 credits', min_players=10, max_players=15,
        waitlist_mode='auto_promote',
        team_assignment_mode='balanced', match_duration_minutes=10, is_active=True,
    )
    db.add(template)
    await db.flush()

    def meetup(sid: int, start: datetime, max_players: int = 15) -> Meetup:
        return Meetup(
            id=sid, game_template_id=1, start_time=start, location=template.location,
            fee=template.fee, fee_text=template.fee_text, min_players=10, max_players=max_players, latitude=template.latitude, longitude=template.longitude,
            waitlist_mode='broadcast' if scenario == 'broadcast' and sid == 1 else 'auto_promote',
            team_assignment_mode='random' if scenario == 'random' and sid == 1 else 'balanced',
            duration_minutes=120, match_duration_minutes=10, max_teams=3,
            team_names_json=json.dumps(TEAM_NAMES),
        )

    # 'live': the meetup started 20 min ago, so the presence window (T-15 min
    # head) and the overview's results mode are both open around the live
    # rehearsal match. 'kickoff': starts right now; the first match is
    # prepared (pending) and the live-match/steward controls are unlocked.
    if scenario == 'live':
        upcoming_start = anchor - timedelta(minutes=20)
    elif scenario == 'kickoff':
        upcoming_start = anchor
    else:
        upcoming_start = kickoff
    live_like = scenario in ('live', 'kickoff')
    # live/kickoff: a full 16-player house (the headroom comes from the
    # bumped max_players below), fielded as 3 teams of 5 + 1 bench player.
    upcoming = meetup(1, upcoming_start, max_players=16 if live_like else 15)
    upcoming.weather_forecast_temp_c = 22
    upcoming.weather_forecast_code = 1
    upcoming.weather_forecast_label = 'Mainly clear'
    upcoming.weather_forecast_fetched_at = anchor
    db.add(upcoming)
    full = scenario in ('full', 'broadcast')
    confirmed = list(range(1, 16 if live_like else 15 if full else 14 if scenario == 'squad' else 12)) + [21]
    waitlisted = [16, 17, 18] if full else []
    for index, uid in enumerate(confirmed + waitlisted):
        db.add(Attendance(meetup_id=1, user_id=uid,
                          status='confirmed' if uid in confirmed else 'waitlisted',
                          joined_at=anchor - timedelta(hours=24) + timedelta(minutes=index)))
    db.add(Attendance(meetup_id=1, user_id=15, status='cancelled', previous_status='confirmed', joined_at=anchor))
    guest_first_name, guest_last_name = NAMES[guest_index].split(' ', 1)
    db.add(GuestPlusOne(
        meetup_id=1, inviter_id=2, guest_user_id=21, first_name=guest_first_name, last_name=guest_last_name,
        skill=3, claim_token='demo-guest-reservation', status='pending', created_at=anchor,
    ))
    db.add(UserNotificationPreference(user_id=2, category='chat', enabled=False))
    db.add(GameTemplateSubscription(user_id=19, game_template_id=1, notifications_enabled=False))

    # Recent ratings stay open until the upcoming kickoff; older weeks are locked.
    for sid, start in [(2, anchor - timedelta(hours=4)), (3, anchor - timedelta(days=7)), (4, anchor - timedelta(days=14))]:
        past = meetup(sid, start)
        past.weather_actual_temp_c = 19 + sid
        past.weather_actual_code = 2
        past.weather_actual_label = 'Partly cloudy'
        past.weather_actual_recorded_at = start + timedelta(hours=2)
        db.add(past)
        for uid in range(1, 16):
            db.add(Attendance(meetup_id=sid, user_id=uid, status='confirmed', joined_at=start - timedelta(days=1)))
        teams = [list(range(1, 6)), list(range(6, 11)), list(range(11, 16))]
        past.manual_teams_json = json.dumps(teams)
        rng = random.Random(f'demo-goals-{sid}')
        # A couple of own goals so the OG flag and its ranking toggle have coverage.
        own_goals = {(3, 2, 'a', 0), (4, 5, 'b', 0)}
        for index, (a, b) in enumerate([(0, 1), (1, 2), (2, 0), (0, 1), (1, 2), (2, 0)], 1):
            match = MeetupMatch(
                meetup_id=sid, match_number=index, team_a_users=json.dumps(teams[a]), team_b_users=json.dumps(teams[b]),
                team_a_name=TEAM_NAMES[a], team_b_name=TEAM_NAMES[b],
                score_a=1 + index % 3, score_b=index % 2, status='completed',
                timer_total_seconds=600, timer_seconds_remaining=0,
                created_at=start + timedelta(minutes=10 * (index - 1)), completed_at=start + timedelta(minutes=10 * index),
            )
            db.add(match)
            await db.flush()
            for team, scorers, conceded_by in (('a', teams[a], teams[b]), ('b', teams[b], teams[a])):
                for goal_no in range(match.score_a if team == 'a' else match.score_b):
                    own = (sid, index, team, goal_no) in own_goals
                    keeper = team_keeper(conceded_by)
                    pool = [u for u in conceded_by if u != keeper] if own else scorers
                    scorer = rng.choice(pool)
                    assist = None if own else rng.choice([u for u in scorers if u != scorer])
                    elapsed = rng.randint(0, 599)
                    db.add(MatchGoal(
                        match_id=match.id, team=team, scorer_id=scorer, assist_id=assist,
                        goalkeeper_id=keeper,
                        clock_secs=600 - elapsed, clock_minute=elapsed // 60 + 1, after_whistle=False,
                        is_own_goal=own,
                        recorded_by=1, intent_id=f'demo-{sid}-{index}-{team}-{goal_no}',
                        created_at=match.created_at + timedelta(seconds=elapsed),
                    ))
        for rater in range(1, 16):
            if sid == 2 and rater == 2:
                continue  # Member has an editable rating task to demonstrate.
            for ratee in range(1, 16):
                if rater != ratee:
                    db.add(Rating(meetup_id=sid, rater_id=rater, ratee_id=ratee,
                                  score=3 + (rater + ratee + sid) % 3,
                                  created_at=start + timedelta(hours=2), updated_at=start + timedelta(hours=2)))

    for uid, message, minutes in [
        (1, 'Pitch 2 is booked. Please arrive ten minutes before kickoff.', 32),
        (2, 'I will bring the bibs. Looking forward to it!', 26),
        (3, 'I have the ball and a pump.', 19),
        (4, 'See you there! The entrance is beside the café.', 12),
    ]:
        db.add(ChatMessage(meetup_id=1, user_id=uid, message=message, created_at=anchor - timedelta(minutes=minutes)))
    db.add(ChatMessage(meetup_id=2, user_id=1, message='Great games today. Results are up—remember to rate your teammates.', created_at=anchor - timedelta(hours=1)))
    await db.flush()
    await refresh_player_skills(db)

    players = [{'id': u.id, 'skill': draft_skill(u.calculated_skill)} for u in [*members, placeholder] if u.id in confirmed]
    if live_like:
        # 3 teams of 5 (skill-snake) + the lowest-rated player as the bench
        # pool — a 1-person bench is valid per validate_team_partition.
        ordered = sorted(players, key=lambda p: float(p['skill']), reverse=True)
        teams = [[p['id'] for p in t] for t in assign_teams_snake(ordered[:15], max_teams=3)]
        teams.append([ordered[15]['id']])
    elif scenario == 'random':
        order = confirmed[:]
        random.Random(2026).shuffle(order)
        teams = [order[i::3] for i in range(3)]
    else:
        teams = [[p['id'] for p in team] for team in assign_teams_snake(players, max_teams=3)]
    upcoming.manual_teams_json = json.dumps(teams)
    if scenario == 'live':
        # A rehearsal started ahead of kickoff; paused so the initial capture is repeatable.
        paused = anchor - timedelta(seconds=10)
        db.add(MeetupMatch(
            meetup_id=1, match_number=1, team_a_users=json.dumps(teams[0]), team_b_users=json.dumps(teams[1]),
            team_a_name=TEAM_NAMES[0], team_b_name=TEAM_NAMES[1], score_a=2, score_b=1, status='active',
            timer_total_seconds=600, timer_seconds_remaining=402,
            timer_started_at=paused - timedelta(seconds=198),
            timer_pause_intervals=json.dumps([{'paused_at': paused.isoformat(), 'resumed_at': None}]),
            created_at=paused - timedelta(seconds=198),
        ))
    if scenario == 'kickoff':
        # First round prepared, not started — one match per pitch pair. The
        # final partition is the bench pool, never a playing side.
        for idx, (a, b) in enumerate([(0, 1), (2, 3)]):
            if b >= len(teams) - 1:
                break
            db.add(MeetupMatch(
                meetup_id=1, match_number=idx + 1,
                team_a_users=json.dumps(teams[a]), team_b_users=json.dumps(teams[b]),
                team_a_name=TEAM_NAMES[a], team_b_name=TEAM_NAMES[b],
                score_a=0, score_b=0, status='pending',
                timer_total_seconds=600, timer_seconds_remaining=None,
                created_at=anchor,
            ))
    await db.commit()
    return {'scenario': scenario, 'anchor_utc': anchor.isoformat(), 'actors': ACTORS,
            'upcoming_meetup_id': 1, 'ratings_meetup_id': 2,
            'guest_claim_path': '/plus-one/demo-guest-reservation',
            'confirmed': len(confirmed), 'waitlisted': len(waitlisted)}
