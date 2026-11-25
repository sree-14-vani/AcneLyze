import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button, Card, Chip, Disclaimer, ErrorBlock, SafeImage, SectionHeading } from '../components/UI';
import type { ProduceCatalog, ProduceItem } from '../types';

const FAVOURITES_KEY = 'acneclear:produce-favourites';

function readFavourites(): string[] {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export default function NutritionPage() {
  const { t } = useI18n();
  const [kind, setKind] = useState<'fruit' | 'vegetable'>('fruit');
  const [tag, setTag] = useState<string | undefined>();
  const [catalog, setCatalog] = useState<ProduceCatalog | null>(null);
  const [favourites, setFavourites] = useState<string[]>(readFavourites);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = kind === 'fruit' ? await api.fruits(tag) : await api.vegetables(tag);
      setCatalog(data);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [kind, tag]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFavourite = (id: string) => {
    const next = favourites.includes(id)
      ? favourites.filter((value) => value !== id)
      : [...favourites, id];
    setFavourites(next);
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
  };

  return (
    <div>
      <SectionHeading eyebrow="AcneLyze AI" title={t('navNutrition')} subtitle={t('nutritionIntro')} />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={kind === 'fruit' ? 'primary' : 'soft'} onClick={() => { setKind('fruit'); setTag(undefined); }}>
            {t('fruits')}
          </Button>
          <Button variant={kind === 'vegetable' ? 'primary' : 'soft'} onClick={() => { setKind('vegetable'); setTag(undefined); }}>
            {t('vegetables')}
          </Button>
          <span className="mx-2 h-5 w-px bg-line" />
          <Button variant={!tag ? 'primary' : 'soft'} onClick={() => setTag(undefined)}>All</Button>
          {(catalog?.available_filters || []).map((value) => (
            <Button key={value} variant={tag === value ? 'primary' : 'soft'} onClick={() => setTag(value)}>
              {value.replace('_', ' ')}
            </Button>
          ))}
          {loading && <span className="text-xs text-muted">{t('loading')}</span>}
        </div>
        {error && <div className="mt-4"><ErrorBlock message={error} onRetry={load} /></div>}
      </Card>

      {catalog && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.items.map((item: ProduceItem) => (
            <Card key={item.id}>
              <div className="overflow-hidden rounded-xl border border-line bg-white">
                <SafeImage
                  src={item.image_url}
                  alt={item.name}
                  className="h-40 w-full object-cover"
                  fallbackLabel="No verified image"
                />
              </div>
              <div className="mt-3 flex items-start justify-between gap-2">
                <h2 className="font-display text-lg font-semibold text-ink">{item.name}</h2>
                <button
                  type="button"
                  onClick={() => toggleFavourite(item.id)}
                  className="rounded-full border border-line px-2 py-1 text-[11px] font-medium text-muted hover:bg-powder/50"
                  aria-label={favourites.includes(item.id) ? t('removeFavourite') : t('addFavourite')}
                >
                  {favourites.includes(item.id) ? t('removeFavourite') : t('addFavourite')}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags.map((value) => <Chip key={value} tone="green">{value.replace('_', ' ')}</Chip>)}
              </div>
              <p className="mt-3 text-xs text-ink">{item.benefits}</p>
              <p className="muted mt-2 text-xs"><span className="font-semibold">{t('ingredients')}:</span> {item.nutrients.join(', ')}</p>
              <p className="muted mt-1 text-xs"><span className="font-semibold">{t('serving')}:</span> {item.serving}</p>
              {'preparation' in item && item.preparation && (
                <p className="muted mt-1 text-xs">{item.preparation}</p>
              )}
              <p className="muted mt-1 text-xs"><span className="font-semibold">{t('alternatives')}:</span> {item.alternatives.join(', ')}</p>
              {item.warnings && <p className="mt-2 text-xs text-amber-700">{item.warnings}</p>}
              {item.source_url && (
                <p className="muted mt-2 text-[11px]">
                  {t('source')}:{' '}
                  <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="font-medium text-sky underline underline-offset-2">
                    {item.source_name || item.source_url}
                  </a>
                </p>
              )}
              {item.source_note && <p className="muted mt-1 text-[11px]">{item.source_note}</p>}
            </Card>
          ))}
        </div>
      )}
      <Disclaimer text={t('disclaimer')} />
    </div>
  );
}
