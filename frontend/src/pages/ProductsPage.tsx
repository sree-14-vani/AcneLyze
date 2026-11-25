import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useApp } from '../context/AppContext';
import type { AnalysisResult, DetectionResult, ProductCatalog, ProductItem } from '../types';
import { toVisibleAnalysis } from '../lib/regions';
import { Button, Card, Chip, Disclaimer, EmptyState, ErrorBlock, SafeImage, SectionHeading } from '../components/UI';

const CATEGORIES = ['all', 'cleanser', 'treatment', 'moisturizer', 'sunscreen', 'accessory'];
const SKIN_TYPES = ['oily', 'dry', 'combination', 'sensitive', 'normal'];

function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function latestDetection(): DetectionResult | null {
  try {
    const raw = localStorage.getItem('acneclear:latest-detection');
    return raw ? (JSON.parse(raw) as DetectionResult) : null;
  } catch {
    return null;
  }
}

function latestAnalysis(): AnalysisResult | null {
  try {
    const raw = localStorage.getItem('acneclear:latest-skin-disease-analysis');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AnalysisResult> & { analysis?: AnalysisResult };
    const analysis = (parsed.analysis ?? parsed) as AnalysisResult;
    return Array.isArray(analysis.regions) ? analysis : null;
  } catch {
    return null;
  }
}

function ProductImage({ item }: { item: ProductItem }) {
  return (
    <div className="mb-3 h-32 w-full overflow-hidden rounded-xl border border-line bg-white">
      <SafeImage
        src={item.image_url}
        alt={item.name}
        className="h-full w-full object-contain"
        fallbackLabel="No verified product image"
      />
    </div>
  );
}

function SourceLine({ item, label }: { item: ProductItem; label: string }) {
  const sourceUrl = safeHttpUrl(item.source_url);
  if (!sourceUrl && !item.source_name) return null;
  return (
    <p className="mt-1 text-[11px] text-muted">
      {label}:{' '}
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-sky underline underline-offset-2"
        >
          {item.source_name || sourceUrl}
        </a>
      ) : (
        item.source_name
      )}
    </p>
  );
}

export default function ProductsPage() {
  const { t } = useI18n();
  const { profile, preferences, updatePreferences, pushToast } = useApp();
  const [skinType, setSkinType] = useState(profile?.skin_type || 'combination');
  const [sensitivities, setSensitivities] = useState(preferences.sensitivities.join(', '));
  const [existingRoutine, setExistingRoutine] = useState(preferences.current_routine);
  const [category, setCategory] = useState('all');
  const [catalog, setCatalog] = useState<ProductCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<ProductItem | null>(null);

  useEffect(() => {
    setSkinType(profile?.skin_type || 'combination');
    setSensitivities(preferences.sensitivities.join(', '));
    setExistingRoutine(preferences.current_routine);
  }, [profile?.skin_type, preferences.sensitivities, preferences.current_routine]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const detection = latestDetection();
      const analysis = latestAnalysis();
      const visible = analysis ? toVisibleAnalysis(analysis) : undefined;
      const values = parseList(sensitivities);
      const data = await api.products({
        skin_type: skinType,
        concerns: detection?.detected_classes || visible?.concerns || undefined,
        sensitivities: values,
        existing_routine: existingRoutine,
        category: category === 'all' ? undefined : category,
        analysis: visible,
      });
      setCatalog(data);
      void updatePreferences({
        sensitivities: values,
        current_routine: existingRoutine,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  const addToRoutine = (item: ProductItem) => {
    const entry = `${item.brand} ${item.name}: ${item.usage}`;
    const next = existingRoutine ? `${existingRoutine}\n${entry}` : entry;
    setExistingRoutine(next);
    void updatePreferences({ current_routine: next });
    pushToast(t('addedToRoutine'), 'success');
  };

  return (
    <div>
      <SectionHeading eyebrow="AcneLyze AI" title={t('navProducts')} subtitle={t('productsIntro')} />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="label">{t('skinType')}</span>
            <select className="field" value={skinType} onChange={(event) => setSkinType(event.target.value)}>
              {SKIN_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('category')}</span>
            <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('productSensitivities')}</span>
            <input
              className="field"
              value={sensitivities}
              onChange={(event) => setSensitivities(event.target.value)}
              placeholder="fragrance, retinol"
            />
          </label>
          <label className="block">
            <span className="label">{t('existingRoutine')}</span>
            <input className="field" value={existingRoutine} onChange={(event) => setExistingRoutine(event.target.value)} />
          </label>
        </div>
        <div className="mt-4">
          <Button onClick={generate} loading={loading}>
            {t('generateRecommendations')}
          </Button>
        </div>
        {error && <div className="mt-4"><ErrorBlock message={error} onRetry={generate} /></div>}
      </Card>

      {catalog && (
        <div className="mt-5 space-y-5">
          {catalog.notices.map((notice) => (
            <p key={notice} className="text-xs text-muted">{notice}</p>
          ))}
          {Object.entries(catalog.by_category).map(([name, items]) => (
            <Card key={name}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold capitalize text-ink">{name}</h2>
                <Chip tone="blue">{items.length}</Chip>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-line bg-[#fafbfe] p-4">
                    <ProductImage item={item} />
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{item.brand}</p>
                        <h3 className="font-semibold text-ink">{item.name}</h3>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {(item.active_ingredients || []).slice(0, 2).map((active) => (
                          <Chip key={active} tone="peach">{active.replace('_', ' ')}</Chip>
                        ))}
                      </div>
                    </div>
                    <p className="muted mt-2 text-xs">{item.reason}</p>
                    <p className="mt-2 text-xs text-ink">{item.benefits}</p>
                    {item.source_note && <p className="muted mt-2 text-[11px]">{item.source_note}</p>}
                    <SourceLine item={item} label={t('source')} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="soft" onClick={() => setDetails(item)}>{t('viewDetails')}</Button>
                      <Button variant="ghost" onClick={() => addToRoutine(item)}>{t('saveToRoutine')}</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {catalog.count === 0 && (
            <EmptyState title={t('noRecommendations')} detail={t('productSensitivities')} />
          )}
        </div>
      )}

      {details && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetails(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{details.brand}</p>
                <h2 className="font-display text-xl font-semibold text-ink">{details.name}</h2>
              </div>
              <Button variant="ghost" onClick={() => setDetails(null)}>✕</Button>
            </div>
            <ProductImage item={details} />
            <div className="mt-4 space-y-3 text-sm">
              <div><p className="font-semibold text-ink">{t('ingredients')}</p><p className="muted text-xs">{details.ingredients.join(', ')}</p></div>
              <div><p className="font-semibold text-ink">{t('benefits')}</p><p className="muted text-xs">{details.benefits}</p></div>
              <div><p className="font-semibold text-ink">{t('usage')}</p><p className="muted text-xs">{details.usage}</p></div>
              <div><p className="font-semibold text-ink">{t('precautions')}</p><p className="muted text-xs">{details.precautions}</p></div>
              <p className="text-xs text-muted">{details.source_note}</p>
              <SourceLine item={details} label={t('source')} />
            </div>
          </div>
        </div>
      )}
      <Disclaimer text={t('disclaimer')} />
    </div>
  );
}
