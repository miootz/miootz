import logging

from app.services.recurring_sessions import materialize_next_session_and_notify

logger = logging.getLogger(__name__)


async def run_recurrence_rule_job(rule_id: int) -> None:
    """Weekly cron: create next kickoff if missing, then send join-link emails."""
    created = await materialize_next_session_and_notify(rule_id)
    logger.info(
        "Recurrence job rule_id=%s created_session=%s",
        rule_id,
        created,
    )
