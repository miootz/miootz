import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import { MapPin, Trash2 } from "lucide-react";

const defaultIcon = new L.Icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export interface GeoPoint {
  lat: number;
  lng: number;
}

function ClickHandler({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * Tap-to-place venue coordinates picker (Leaflet).
 * No geocoding — admins pin the location by tapping the map.
 */
export function LocationPicker({
  value,
  onChange,
  initialCenter = [51.5, -0.12],
}: {
  value: GeoPoint | null;
  onChange: (v: GeoPoint | null) => void;
  /** Map center when no pin is set yet. */
  initialCenter?: [number, number];
}) {
  const center: [number, number] = value
    ? [value.lat, value.lng]
    : initialCenter;

  return (
    <div className="space-y-2">
      <div className="relative z-0 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <MapContainer
          center={center}
          zoom={value ? 15 : 13}
          className="h-64 w-full"
          scrollWheelZoom
          aria-label="Venue location map — tap to place a pin"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={(lat, lng) => onChange({ lat, lng })} />
          {value && (
            <Marker position={[value.lat, value.lng]} icon={defaultIcon} />
          )}
        </MapContainer>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {value
            ? `Pinned: ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`
            : "Tap the map to pin the venue location."}
        </p>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
