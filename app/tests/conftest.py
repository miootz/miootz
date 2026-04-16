import os

# Avoid background scheduler threads during pytest unless explicitly enabled.
os.environ.setdefault("SCHEDULER_ENABLED", "false")
# Tests send Remote-User without Traefik forwarded headers.
os.environ.setdefault("AUTH_REQUIRE_FORWARDED_HEADERS", "false")
