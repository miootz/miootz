import { useEffect, useState } from 'react';
import { Cloud, CloudFog, CloudRain, CloudSnow, Sun } from 'lucide-react';
import { format } from 'date-fns';
import { parseSessionStart } from '../utils/datetime';

function codeToIcon(code: number): { Icon: typeof Sun; label: string } {
  if (code === 0) return { Icon: Sun, label: 'Clear' };
  if (code <= 3) return { Icon: Cloud, label: 'Cloudy' };
  if (code <= 48) return { Icon: CloudFog, label: 'Fog' };
  if (code <= 67) return { Icon: CloudRain, label: 'Rain' };
  if (code <= 77) return { Icon: CloudSnow, label: 'Snow' };
  if (code <= 82) return { Icon: CloudRain, label: 'Showers' };
  if (code <= 86) return { Icon: CloudSnow, label: 'Snow' };
  return { Icon: CloudRain, label: 'Weather' };
}

interface MeetupWeatherBadgeProps {
  latitude: number;
  longitude: number;
  startTime: string;
}

export function MeetupWeatherBadge({
  latitude,
  longitude,
  startTime,
}: MeetupWeatherBadgeProps) {
  const [label, setLabel] = useState<string | null>(null);
  const [Icon, setIcon] = useState<typeof Sun | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const day = format(parseSessionStart(startTime), 'yyyy-MM-dd');
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('daily', 'weathercode');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('start_date', day);
    url.searchParams.set('end_date', day);

    void fetch(url.toString())
      .then((r) => r.json())
      .then((data: { daily?: { time?: string[]; weathercode?: number[] } }) => {
        if (cancelled) return;
        const times = data.daily?.time ?? [];
        const idx = times.indexOf(day);
        const code = idx >= 0 ? data.daily?.weathercode?.[idx] : undefined;
        if (typeof code !== 'number') {
          setErr(true);
          return;
        }
        const mapped = codeToIcon(code);
        setIcon(() => mapped.Icon);
        setLabel(mapped.label);
      })
      .catch(() => {
        if (!cancelled) setErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, startTime]);

  if (err) return null;

  if (!Icon || !label) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 motion-safe:animate-pulse motion-reduce:animate-none">
        Loading weather…
      </p>
    );
  }

  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
      <Icon className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
      <span>{label}</span>
      <span className="text-gray-400 dark:text-gray-500">(forecast)</span>
    </p>
  );
}
