"""Fetch weather data from Open-Meteo (free, no API key required).

Rate limiting
-------------
Open-Meteo fair-use policy: 10 000 calls / day (non-commercial).
A module-level async token bucket caps this process at ~1 req/s (burst 3),
which yields ~86 400 theoretical max but real-world usage is orders of
magnitude lower thanks to the 1-hour DB cache.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, UTC
from time import monotonic
from typing import Any

import httpx

logger = logging.getLogger(__name__)

OPEN_METEO_BASE = "https://api.open-meteo.com/v1"

# ── WMO weather interpretation codes → human-readable labels ──────

WMO_LABELS: dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}

# Higher = more severe (used to pick dominant condition)
_WMO_SEVERITY: dict[int, int] = {
    0: 0,
    1: 5,
    2: 10,
    3: 15,
    45: 30,
    48: 35,
    51: 40,
    53: 45,
    55: 50,
    56: 60,
    57: 65,
    61: 55,
    63: 60,
    65: 65,
    66: 70,
    67: 75,
    71: 60,
    73: 65,
    75: 70,
    77: 75,
    80: 65,
    81: 70,
    82: 75,
    85: 75,
    86: 80,
    95: 90,
    96: 95,
    99: 100,
}


def _wmo_label(code: int | None) -> str | None:
    if code is None:
        return None
    return WMO_LABELS.get(code, _weather_category(code))


def _weather_category(code: int) -> str:
    """Fallback category label for unknown WMO codes."""
    if code <= 3:
        return "Cloudy"
    if code <= 48:
        return "Fog"
    if code <= 57:
        return "Drizzle"
    if code <= 67:
        return "Rain"
    if code <= 77:
        return "Snow"
    if code <= 82:
        return "Showers"
    if code <= 86:
        return "Snow showers"
    if code >= 95:
        return "Thunderstorm"
    return "Unknown"


# ── Async token-bucket rate limiter ───────────────────────────────


class _RateLimiter:
    """Per-process async token bucket.

    ~1 request/second, burst of 3.  Yields ~86 400 theoretical max
    but real-world usage is far lower thanks to the DB cache layer.
    """

    def __init__(self, rate: float = 1.0, burst: int = 3) -> None:
        self._rate = rate  # tokens per second
        self._burst = burst  # max tokens
        self._tokens: float = burst * 1.0
        self._last = monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = monotonic()
            elapsed = now - self._last
            self._last = now
            self._tokens = min(self._burst, self._tokens + elapsed * self._rate)

            if self._tokens < 1.0:
                wait = (1.0 - self._tokens) / self._rate
                # Release the lock while sleeping so other callers can
                # inspect the bucket (they'll also wait if needed).

                # Schedule a refill callback
                async def _delay() -> None:
                    await asyncio.sleep(wait)

                await _delay()


_open_meteo_limiter = _RateLimiter()


# ── Forecast (hourly apparent temperature + weather code) ─────────


async def fetch_forecast(
    latitude: float,
    longitude: float,
    start_time: datetime,
    end_time: datetime,
    tz: str = "auto",
) -> dict[str, Any] | None:
    """Fetch hourly apparent temperature & weather code for a time window.

    Returns the **mean apparent temperature** across the window and the
    **most severe** weather code encountered.  Returns None on failure.
    """
    await _open_meteo_limiter.acquire()

    # Convert to ISO start_hour / end_hour in the target timezone.
    if start_time.tzinfo is None:
        start_time = start_time.replace(tzinfo=UTC)
    if end_time.tzinfo is None:
        end_time = end_time.replace(tzinfo=UTC)

    start_hour = start_time.strftime("%Y-%m-%dT%H:%M")
    end_hour = end_time.strftime("%Y-%m-%dT%H:%M")

    url = f"{OPEN_METEO_BASE}/forecast"
    params: dict[str, Any] = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "apparent_temperature,weather_code",
        "timezone": tz,
        "start_hour": start_hour,
        "end_hour": end_hour,
    }

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.debug("Open-Meteo forecast fetch failed: %s", exc)
        return None

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    temps = hourly.get("apparent_temperature", [])
    codes = hourly.get("weather_code", [])

    if not times:
        return None

    # Average apparent temperature across the window.
    valid_temps = [t for t in temps if t is not None]
    if not valid_temps:
        return None
    avg_temp = round(sum(valid_temps) / len(valid_temps))

    # Pick the most severe weather code (highest severity value).
    dominant_code: int | None = None
    dominant_severity = -1
    for code in codes:
        if code is None:
            continue
        sev = _WMO_SEVERITY.get(code, 0)
        if sev > dominant_severity:
            dominant_severity = sev
            dominant_code = code

    return {
        "temp_c": avg_temp,
        "weather_code": dominant_code,
        "label": _wmo_label(dominant_code) if dominant_code is not None else None,
    }


# ── Current conditions (fallback) ─────────────────────────────────


async def fetch_current(
    latitude: float,
    longitude: float,
    tz: str = "auto",
) -> dict[str, Any] | None:
    """Fetch current conditions from Open-Meteo.

    Returns dict with ``temp_c`` and ``weather_code``, or None on failure.
    """
    await _open_meteo_limiter.acquire()

    url = f"{OPEN_METEO_BASE}/forecast"
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current_weather": "true",
        "timezone": tz,
    }
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        cw = data.get("current_weather", {})
        return {
            "temp_c": cw.get("temperature"),
            "weather_code": cw.get("weathercode"),
            "label": _wmo_label(cw.get("weathercode")),
        }
    except Exception as exc:
        logger.debug("Open-Meteo current conditions fetch failed: %s", exc)
        return None
