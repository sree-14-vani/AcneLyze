import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, RotateCcw, UploadCloud, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface Props {
  preview: string | null;
  onSelect: (file: File, previewUrl: string) => void;
  onClear?: () => void;
  label?: string;
  hint?: string;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export default function ImageUploader({ preview, onSelect, onClear, label, hint }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const cameraSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraOpen]);

  const accept = (file?: File | null) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError(t('invalidImage'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t('supportedFormats'));
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setError(null);
    onSelect(file, url);
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
    setCameraStarting(false);
  };

  const startCamera = async () => {
    setError(null);
    setCameraError(null);
    if (!cameraSupported) {
      setCameraError(t('cameraUnsupported'));
      return;
    }

    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : '';
      setCameraError(
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? t('cameraPermissionDenied')
          : t('cameraError'),
      );
    } finally {
      setCameraStarting(false);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError(t('cameraError'));
      return;
    }

    const canvas = document.createElement('canvas');
    const side = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError(t('cameraError'));
      return;
    }
    context.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      side,
      side,
    );
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError(t('cameraError'));
          return;
        }
        const file = new File([blob], `acneclear-camera-${Date.now()}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        stopCamera();
        accept(file);
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          accept(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {cameraOpen ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-ink">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="max-h-[440px] min-h-[260px] w-full bg-black object-cover"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-3 py-2.5">
            <span className="text-xs font-medium text-muted">{t('cameraHint')}</span>
            <div className="flex gap-2">
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={capture}>
                <Camera size={14} /> {t('capture')}
              </button>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={stopCamera}>
                <X size={14} /> {t('closeCamera')}
              </button>
            </div>
          </div>
        </div>
      ) : preview ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-powder/20">
          <div className="relative flex max-h-[440px] items-center justify-center overflow-hidden">
            <img src={preview} alt={t('imagePreview')} className="max-h-[440px] w-auto max-w-full object-contain" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-3 py-2.5">
            <span className="text-xs font-medium text-muted">{t('imagePreview')}</span>
            <div className="flex gap-2">
              <button type="button" className="btn-soft px-3 py-1.5 text-xs" onClick={() => inputRef.current?.click()}>
                <ImagePlus size={14} /> {t('changeImage')}
              </button>
              <button
                type="button"
                className="btn-soft px-3 py-1.5 text-xs"
                onClick={() => void startCamera()}
                disabled={!cameraSupported || cameraStarting}
                title={cameraSupported ? undefined : t('cameraUnsupported')}
              >
                <Camera size={14} /> {cameraStarting ? t('loading') : t('takePhoto')}
              </button>
              {onClear && (
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => {
                    setError(null);
                    if (objectUrlRef.current) {
                      URL.revokeObjectURL(objectUrlRef.current);
                      objectUrlRef.current = null;
                    }
                    onClear();
                  }}
                >
                  <RotateCcw size={14} /> {t('reset')}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              accept(event.dataTransfer.files?.[0]);
            }}
            className={`flex min-h-[260px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-8 text-center transition ${
              dragging
                ? 'border-sky bg-powder/50'
                : 'border-line bg-gradient-to-br from-white via-white to-powder/30 hover:border-sky/60'
            }`}
          >
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-powder/70 text-sky">
              <UploadCloud size={25} />
            </div>
            <p className="font-semibold text-ink">{label || t('selectFile')}</p>
            <p className="muted mt-1.5 max-w-xs">{hint || t('dropHere')}</p>
            <p className="mt-4 text-[11px] font-medium text-muted/80">{t('supportedFormats')}</p>
          </button>
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              className="btn-soft px-3 py-1.5 text-xs"
              onClick={() => void startCamera()}
              disabled={!cameraSupported || cameraStarting}
              title={cameraSupported ? undefined : t('cameraUnsupported')}
            >
              <Camera size={14} /> {cameraStarting ? t('loading') : t('takePhoto')}
            </button>
          </div>
        </>
      )}
      {cameraError && <p className="mt-2 text-xs font-medium text-rose-600">{cameraError}</p>}
      {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}
