import { useCallback, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { Navigation } from 'lucide-react';
import { formatDistance, haversineKm } from '../utils/geo';

const defaultIcon = new L.Icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface MeetupLocationSectionProps {
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
}

function directionsGoogle(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function directionsApple(lat: number, lng: number) {
  return `https://maps.apple.com/?daddr=${lat},${lng}`;
}

/** Waze deep link — opens navigation in the installed Waze app (iOS + Android). */
function directionsWaze(lat: number, lng: number) {
  return `waze://?ll=${lat},${lng}&navigate=yes`;
}

/** Waze deep links only resolve on iOS/Android, so the link is iOS/Android-only. */
const isWazePlatform = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

function directionsSearchQuery(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function MeetupLocationSection({
  location,
  latitude,
  longitude,
}: MeetupLocationSectionProps) {
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [distanceError, setDistanceError] = useState<string | null>(null);
  const [distanceBusy, setDistanceBusy] = useState(false);
  const [wazeOs] = useState(isWazePlatform);

  const hasCoords =
    latitude != null &&
    longitude != null &&
    !Number.isNaN(latitude) &&
    !Number.isNaN(longitude);

  const measureDistance = useCallback(() => {
    if (!hasCoords) return;
    setDistanceError(null);
    setDistanceBusy(true);
    if (!navigator.geolocation) {
      setDistanceError('Location is not available in this browser.');
      setDistanceBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const km = haversineKm(
          pos.coords.latitude,
          pos.coords.longitude,
          latitude!,
          longitude!
        );
        setDistanceKm(km);
        setDistanceBusy(false);
      },
      () => {
        setDistanceError('Could not read your location (permission denied or unavailable).');
        setDistanceBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
    );
  }, [hasCoords, latitude, longitude]);

  if (!location && !hasCoords) return null;

  return (
    <section className="border border-line bg-panel p-4 text-left">
      {location && (
        <p className="mb-3 text-sm text-ink">{location}</p>
      )}

      {hasCoords && (
        <div className="relative z-0 mb-3 overflow-hidden border border-line">
          <MapContainer
            center={[latitude!, longitude!]}
            zoom={15}
            className="h-56 w-full"
            scrollWheelZoom
            aria-label="Map of meetup location"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[latitude!, longitude!]} icon={defaultIcon}>
              {location && <Popup>{location}</Popup>}
            </Marker>
          </MapContainer>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {hasCoords ? (
          <>
            {wazeOs && (
              <a
                href={directionsWaze(latitude!, longitude!)}
                className="inline-flex items-center gap-1.5 border border-line px-3 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink"
              >
                <Navigation className="h-4 w-4" aria-hidden />
                Open in Waze
              </a>
            )}
            <a
              href={directionsGoogle(latitude!, longitude!)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 border border-line px-3 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink"
            >
              <Navigation className="h-4 w-4" aria-hidden />
              Google Maps
            </a>
            <a
              href={directionsApple(latitude!, longitude!)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 border border-line px-3 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink"
            >
              Apple Maps
            </a>
            <button
              type="button"
              onClick={() => void measureDistance()}
              disabled={distanceBusy}
              className="inline-flex items-center gap-1.5 border border-line px-3 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              {distanceBusy ? 'Getting location…' : 'Distance from me'}
            </button>
          </>
        ) : (
          location && (
            <a
              href={directionsSearchQuery(location)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 border border-line px-3 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink"
            >
              <Navigation className="h-4 w-4" aria-hidden />
              Google Maps
            </a>
          )
        )}
      </div>

      {distanceKm != null && hasCoords && (
        <p className="mt-2 text-sm text-ink-dim">
          About <strong className="font-semibold tabular-nums text-ink">{formatDistance(distanceKm)}</strong> from your position.
        </p>
      )}
      {distanceError && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {distanceError}
        </p>
      )}
    </section>
  );
}
