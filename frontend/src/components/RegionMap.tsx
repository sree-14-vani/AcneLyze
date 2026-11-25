import type { AnalysisResult, SkinRegion } from '../types';
import { REGION_COLORS } from '../lib/regions';
import { useI18n } from '../lib/i18n';

export default function RegionMap({
  analysis,
  imageSrc,
  selected,
  onSelect,
}: {
  analysis: AnalysisResult;
  imageSrc?: string | null;
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#f7f9fc]">
      <div
        className="relative mx-auto w-full"
        style={{ aspectRatio: `${analysis.image_width || 3} / ${analysis.image_height || 4}` }}
      >
        {imageSrc ? (
          <img src={imageSrc} alt={t('imagePreview')} className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-[78%] w-[58%] rounded-[48%] border border-powder bg-gradient-to-br from-powder/50 to-lavender/40" />
          </div>
        )}

        {analysis.regions.map((region: SkinRegion) => {
          const color = REGION_COLORS[region.id];
          const isSelected = selected === region.id;
          return (
            <button
              key={region.id}
              type="button"
              onClick={() => onSelect?.(region.id)}
              title={`${region.label}: ${region.score}`}
              className="absolute rounded-xl border-2 transition-all duration-200 hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              style={{
                left: `${region.box.x * 100}%`,
                top: `${region.box.y * 100}%`,
                width: `${region.box.width * 100}%`,
                height: `${region.box.height * 100}%`,
                borderColor: color,
                background: `${color}${isSelected ? '44' : '18'}`,
                boxShadow: isSelected ? `0 0 0 4px ${color}33` : undefined,
              }}
            >
              <span
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm sm:text-[10px]"
                style={{ background: color }}
              >
                {region.score}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 border-t border-line bg-white px-3 py-2.5">
        {analysis.regions.map((region) => (
          <button
            key={region.id}
            onClick={() => onSelect?.(region.id)}
            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition ${
              selected === region.id ? 'bg-powder text-ink' : 'text-muted hover:bg-powder/50'
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: REGION_COLORS[region.id] }} />
            {region.label}
          </button>
        ))}
      </div>
    </div>
  );
}
