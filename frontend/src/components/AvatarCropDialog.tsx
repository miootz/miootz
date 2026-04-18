import { useCallback, useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { saveAvatarCrop } from '../api/meApi';
import { useToast } from '../context/ToastContext';

interface AvatarCropDialogProps {
  open: boolean;
  /** Same-origin path to the full upload, e.g. `/uploads/…_src.jpg` (no cropped JPEG). */
  imageSrc: string;
  /** Last saved crop on the source image (natural pixels); restores zoom + pan via Cropper. */
  initialCroppedAreaPixels: Area | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function AvatarCropDialog({
  open,
  imageSrc,
  initialCroppedAreaPixels,
  onClose,
  onSaved,
}: AvatarCropDialogProps) {
  const { showToast } = useToast();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cache-bust the original image so the browser does not reuse a stale cached file. */
  const [bustedSrc, setBustedSrc] = useState(imageSrc);

  const onCropComplete = useCallback((_a: Area, px: Area) => {
    setPixels(px);
  }, []);

  useEffect(() => {
    if (!open) {
      setPixels(null);
      setError(null);
      return;
    }
    const sep = imageSrc.includes('?') ? '&' : '?';
    setBustedSrc(`${imageSrc}${sep}_=${Date.now()}`);
  }, [open, imageSrc]);

  const cropperKey = `${bustedSrc}:${JSON.stringify(initialCroppedAreaPixels)}`;

  const save = async () => {
    if (!pixels) return;
    setSaving(true);
    setError(null);
    try {
      await saveAvatarCrop({
        crop_pixels: {
          x: Math.round(pixels.x),
          y: Math.round(pixels.y),
          width: Math.round(pixels.width),
          height: Math.round(pixels.height),
        },
      });
      await onSaved();
      showToast('Avatar crop saved.', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal
      aria-labelledby="avatar-crop-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-800">
          <h2 id="avatar-crop-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Adjust avatar
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Close
          </button>
        </div>
        <div className="relative h-[min(28rem,70vh)] w-full bg-gray-950">
          <Cropper
            key={cropperKey}
            image={bustedSrc}
            crop={crop}
            zoom={zoom}
            rotation={0}
            aspect={1}
            cropShape="round"
            showGrid={false}
            minZoom={1}
            maxZoom={3}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            initialCroppedAreaPixels={
              initialCroppedAreaPixels
                ? {
                    x: initialCroppedAreaPixels.x,
                    y: initialCroppedAreaPixels.y,
                    width: initialCroppedAreaPixels.width,
                    height: initialCroppedAreaPixels.height,
                  }
                : undefined
            }
          />
        </div>
        <div className="space-y-3 p-4">
          <label className="flex items-center gap-3 text-sm">
            <span className="w-12 shrink-0 text-gray-600 dark:text-gray-400">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.02}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="min-w-0 flex-1 accent-violet-600"
            />
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !pixels}
              onClick={() => void save()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save crop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
