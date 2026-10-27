"""ORM models — imported from `app.api.main` so `create_all` registers tables."""

from app.models.user import User  # noqa: F401
from app.models.meetup import Meetup, Attendance, MatchScore  # noqa: F401
from app.models.chat import ChatMessage  # noqa: F401
from app.models.invite import InviteToken  # noqa: F401
from app.models.game_template import GameTemplate  # noqa: F401
from app.models.game_template_subscription import GameTemplateSubscription  # noqa: F401
from app.models.web_push_subscription import WebPushSubscription  # noqa: F401
from app.models.user_notification_preference import UserNotificationPreference  # noqa: F401
from app.models.rating import Rating  # noqa: F401
from app.models.guest_plus_one import GuestPlusOne  # noqa: F401
from app.models.match import MeetupMatch  # noqa: F401
from app.models.job_queue import JobQueue  # noqa: F401
