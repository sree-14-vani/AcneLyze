import { useState } from 'react';
import { useI18n } from '../lib/i18n';

export default function ImageCompare({
  original,
  enhanced,
  className = '',
}: {
  original: string;
  enhanced: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [position, setPosition] = useState(50);

  return (
    <div className={className}>
      <div
        className="relative h-[320px] overflow-hidden rounded-2xl border border-line bg-[#f6f8fb] sm:h-[460px]"
        style={{ ['--pos' as string]: `${position}%` }}
      >
        <img src={original} alt={t('original')} className="absolute inset-0 h-full w-full object-contain" />
        <img
          src={enhanced}
          alt={t('enhanced')}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 0 0 var(--pos))` }}
        />
        <div className="pointer-events-none absolute inset-y-0 left-[var(--pos)] w-0.5 bg-white shadow-[0_0_0_1px_rgba(35,48,67,0.25)]" />
        <div className="pointer-events-none absolute left-[var(--pos)] top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-sm font-bold text-white shadow-float">
          ↔
        </div>
        <span className="absolute left-3 top-3 rounded-lg bg-ink/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
          {t('original')}
        </span>
        <span className="absolute right-3 top-3 rounded-lg bg-plum/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
          {t('enhanced')}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          aria-label={t('beforeAfter')}
        />
      </div>
      <p className="muted mt-2 text-center text-xs">{t('beforeAfter')}</p>
    </div>
  );
}
