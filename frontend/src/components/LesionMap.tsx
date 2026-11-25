import type { DetectionResult, LesionDetection } from '../types';

const LESION_COLORS: Record<string, string> = {
  Blackheads: '#243B63',
  Whiteheads: '#4A86C4',
  Papules: '#E8895E',
  Pustules: '#C25D48',
  Nodules: '#8A4B34',
  Cysts: '#5C3A2E',
};

export default function LesionMap({
  detection,
  imageSrc,
  selected,
  onSelect,
}: {
  detection: DetectionResult;
  imageSrc?: string | null;
  selected?: string | null;
  onSelect?: (detection: LesionDetection) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#f7f9fc]">
      <div
        className="relative mx-auto w-full"
        style={{ aspectRatio: `${detection.image_width || 3} / ${detection.image_height || 4}` }}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt="Uploaded facial photo with detected lesion boxes"
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
            No preview available
          </div>
        )}
        {detection.detections.map((item, index) => {
          const color = LESION_COLORS[item.label] || '#243B63';
          const isSelected = selected === `${item.label}-${index}`;
          return (
            <button
              key={`${item.label}-${index}`}
              type="button"
              onClick={() => onSelect?.(item)}
              title={`${item.label}: ${(item.confidence * 100).toFixed(1)}%`}
              className="absolute rounded-lg border-2 transition-all hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              style={{
                left: `${item.box.x * 100}%`,
                top: `${item.box.y * 100}%`,
                width: `${item.box.width * 100}%`,
                height: `${item.box.height * 100}%`,
                borderColor: color,
                background: `${color}${isSelected ? '44' : '14'}`,
                boxShadow: isSelected ? `0 0 0 4px ${color}33` : undefined,
              }}
            >
              <span
                className="absolute -top-5 left-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-bold text-white"
                style={{ background: color }}
              >
                {item.label} {(item.confidence * 100).toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 border-t border-line bg-white px-3 py-2.5">
        {Object.entries(LESION_COLORS).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
