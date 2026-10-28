import { useEffect, useState, useCallback } from "react";
import {
    Cloud,
    CloudDrizzle,
    CloudFog,
    CloudRain,
    CloudSnow,
    CloudLightning,
    RefreshCw,
    Sun,
} from "lucide-react";
import { apiFetch } from "../api/client";

// ── WMO weather code → icon + label ─────────────────────────

function codeToIcon(code: number): { Icon: typeof Sun; label: string } {
    if (code === 0) return { Icon: Sun, label: "Clear" };
    if (code <= 1) return { Icon: Sun, label: "Mainly clear" };
    if (code <= 2) return { Icon: Cloud, label: "Partly cloudy" };
    if (code <= 3) return { Icon: Cloud, label: "Overcast" };
    if (code <= 48) return { Icon: CloudFog, label: "Fog" };
    if (code <= 57) return { Icon: CloudDrizzle, label: "Drizzle" };
    if (code <= 67) return { Icon: CloudRain, label: "Rain" };
    if (code <= 77) return { Icon: CloudSnow, label: "Snow" };
    if (code <= 82) return { Icon: CloudRain, label: "Showers" };
    if (code <= 86) return { Icon: CloudSnow, label: "Snow showers" };
    if (code >= 95) return { Icon: CloudLightning, label: "Thunderstorm" };
    return { Icon: CloudRain, label: "Rain" };
}

// ── Types ────────────────────────────────────────────────────

interface WeatherData {
    temperature_c: number;
    weather_code: number | null;
    label: string | null;
}

interface WeatherResponse {
    forecast?: WeatherData & { cached_at: string };
    recorded?: WeatherData & { recorded_at: string };
    can_refresh: boolean;
}

// ── Component ────────────────────────────────────────────────

interface MeetupWeatherBadgeProps {
    meetupId: number;
    /** @deprecated pass meetupId instead */
    latitude?: number;
    /** @deprecated pass meetupId instead */
    longitude?: number;
    /** @deprecated pass meetupId instead */
    startTime?: string;
}

export function MeetupWeatherBadge({ meetupId }: MeetupWeatherBadgeProps) {
    const [data, setData] = useState<WeatherResponse | null>(null);
    const [_loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [err, setErr] = useState(false);

    const load = useCallback(async () => {
        try {
            const r = await apiFetch(`/meetups/${meetupId}/weather`);
            if (!r.ok) {
                if (r.status === 404) return; // meetup without coords
                setErr(true);
                return;
            }
            const json: WeatherResponse = await r.json();
            setData(json);
            setErr(false);
            // If no forecast/recorded data but refresh is allowed, fetch it now.
            if (json.can_refresh && !json.forecast && !json.recorded) {
                void (async () => {
                    try {
                        const refreshR = await apiFetch(
                            `/meetups/${meetupId}/weather/refresh`,
                            {
                                method: "POST",
                            },
                        );
                        if (refreshR.ok) {
                            const raw = await refreshR.json();
                            setData({
                                forecast: {
                                    temperature_c: raw.temperature_c,
                                    weather_code: raw.weather_code ?? null,
                                    label: raw.label ?? null,
                                    cached_at: new Date().toISOString(),
                                },
                                can_refresh: true,
                            });
                        }
                    } catch {
                        /* ignore refresh failure */
                    } finally {
                        setLoading(false);
                    }
                })();
                return; // setLoading(false) happens in the refresh finally block
            }
        } catch {
            setErr(true);
        } finally {
            setLoading(false);
        }
    }, [meetupId]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            const r = await apiFetch(`/meetups/${meetupId}/weather/refresh`, {
                method: "POST",
            });
            if (r.ok) {
                void load();
            }
        } finally {
            setRefreshing(false);
        }
    };

    if (err || !data) return null;

    // Determine which data to show: recorded > forecast > nothing
    const active = data.recorded ?? data.forecast;
    if (!active) return null;

    const isRecorded = !!data.recorded;
    const { Icon, label } =
        active.weather_code != null
            ? codeToIcon(active.weather_code ?? 0)
            : { Icon: Cloud, label: "Unknown" };

    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-dim group">
            <Icon
                className="h-4 w-4 shrink-0 text-ink-dim"
                aria-hidden
            />
            <span className="tabular-nums text-ink">
                {active.temperature_c}°C
            </span>
            <span className="hidden sm:inline text-ink-dim">
                {label}
            </span>
            {isRecorded ? (
                <span className="text-2xs text-ink-faint">
                    (actual)
                </span>
            ) : data.can_refresh ? (
                <span className="flex items-center gap-0.5">
                    <span className="text-2xs text-ink-faint">
                        (forecast)
                    </span>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            void handleRefresh();
                        }}
                        disabled={refreshing}
                        className="p-0.5 text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100 disabled:opacity-50 transition-all"
                        aria-label="Refresh weather forecast"
                        title="Refresh forecast"
                    >
                        <RefreshCw
                            className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                        />
                    </button>
                </span>
            ) : (
                <span className="text-2xs text-ink-faint">
                    (forecast)
                </span>
            )}
        </span>
    );
}

// ── Standalone weather display for history (recorded only) ───

export function RecordedWeatherBadge({
    temperature_c,
    weather_code,
    label,
}: {
    temperature_c: number;
    weather_code: number | null;
    label: string | null;
}) {
    const { Icon } =
        weather_code != null ? codeToIcon(weather_code ?? 0) : { Icon: Cloud };

    return (
        <span className="inline-flex items-center gap-1 text-xs text-ink-dim">
            <Icon
                className="h-3.5 w-3.5 shrink-0 text-ink-dim"
                aria-hidden
            />
            <span className="tabular-nums text-ink">{temperature_c}°C</span>
            {label && <span className="hidden sm:inline">{label}</span>}
        </span>
    );
}
