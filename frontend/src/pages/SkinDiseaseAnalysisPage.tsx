import { useState } from 'react';
import { ScanFace } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import type {
  DietPlan,
  ProduceItem,
  ProductItem,
  RecommendationResponse,
  SkinDiseaseAnalysisResult,
  TipPlan,
} from '../types';
import ImageUploader from '../components/ImageUploader';
import LesionMap from '../components/LesionMap';
import RegionMap from '../components/RegionMap';
import {
  Button,
  Card,
  Chip,
  Disclaimer,
  ErrorBlock,
  LoadingBlock,
  SafeImage,
  SectionHeading,
} from '../components/UI';
import { concernLabel, regionColor, severityLabel, toVisibleAnalysis } from '../lib/regions';

export default function SkinDiseaseAnalysisPage() {
  const { t, language } = useI18n();
  const { recordAnalysis, profile, preferences, pushToast } = useApp();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<SkinDiseaseAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(0.25);
  const [recommendations, setRecommendations] = useState<RecommendationResponse | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);

  const describeError = (caught: unknown) => {
    const message = errorMessage(caught);
    if (/face/i.test(message)) return `${t('faceNotFound')} ${message}`;
    if (/blur|lighting|bright|dark|exposure/i.test(message)) return `${t('uploadHint')} ${message}`;
    if (/size|large|small|dimension/i.test(message)) return `${t('supportedFormats')} ${message}`;
    return message;
  };

  const loadRecommendations = async (data: SkinDiseaseAnalysisResult) => {
    setRecommendationsLoading(true);
    setRecommendationsError(null);
    try {
      const response = await api.recommendations({
        analysis: toVisibleAnalysis(data.analysis),
        detection: data.detection as unknown as Record<string, unknown> | null,
        condition: data.condition as unknown as Record<string, unknown> | null,
        preferences: {
          skin_type: profile?.skin_type || 'combination',
          goals: preferences.skin_goals,
          sensitivities: preferences.sensitivities,
          current_routine: preferences.current_routine,
          diet_type: preferences.diet_type,
          allergies: preferences.allergies,
          dislikes: [],
          weight_kg: preferences.weight_kg,
          meals_per_day: 4,
        },
        language,
      });
      setRecommendations(response);
    } catch (caught) {
      setRecommendationsError(errorMessage(caught));
    } finally {
      setRecommendationsLoading(false);
    }
  };

  const run = async () => {
    if (!file) { setError(t('imageRequired')); return; }
    setLoading(true); setError(null); setRecommendations(null); setRecommendationsError(null);
    try {
      const validation = await api.validateUpload(file);
      if (!validation.valid) { setError(validation.note); return; }
      const data = await api.skinDiseaseAnalysis(file, { confidence });
      setResult(data);
      setSelectedRegion(data.analysis.focus_regions?.[0] || data.analysis.regions?.[0]?.id || null);
      localStorage.setItem('acneclear:latest-skin-disease-analysis', JSON.stringify(data));
      localStorage.setItem('acneclear:latest-detection', JSON.stringify(data.detection || null));
      localStorage.setItem('acneclear:latest-skin-condition', JSON.stringify(data.condition || null));
      if (user) {
        const record = await recordAnalysis(data.analysis, preview || '');
        if (record) pushToast(t('savedToAccount'), 'success');
      } else {
        pushToast(t('signInRequired'), 'info');
      }
      void loadRecommendations(data);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  };

  const activeRegion = result?.analysis.regions.find((r) => r.id === selectedRegion) || result?.analysis.regions[0];
  const condition = result?.condition;
  const detection = result?.detection;
  const hasLesionResults = Boolean(detection && detection.detections.length > 0);

  const renderProduct = (item: ProductItem) => (
    <div key={item.id} className="flex h-full flex-col rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="mb-3 h-40 w-full overflow-hidden rounded-xl border border-line bg-powder/20"><SafeImage src={item.image_url} alt={item.name} className="h-full w-full object-contain" fallbackLabel="No verified product image" /></div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{item.brand}</p>
      <h3 className="mt-1 font-semibold text-ink">{item.name}</h3>
      <p className="mt-2 text-xs text-ink/80">{item.reason || item.benefits}</p>
      <p className="muted mt-3 text-[11px]">{item.usage}</p>
      {item.source_url && <p className="muted mt-2 text-[11px]">{t('source')}: <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="font-medium text-sky underline underline-offset-2">{item.source_name || item.source_url}</a></p>}
    </div>
  );
  const renderProduce = (item: ProduceItem) => (
    <div key={item.id} className="flex h-full flex-col rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="mb-3 h-40 w-full overflow-hidden rounded-xl border border-line bg-powder/20"><SafeImage src={item.image_url} alt={item.name} className="h-full w-full object-cover" fallbackLabel="No verified image" /></div>
      <h3 className="font-semibold text-ink">{item.name}</h3>
      <p className="mt-3 text-xs text-ink/80">{item.benefits}</p>
      {item.personalised_note && <p className="mt-2 text-xs font-medium text-[#243B63]">{item.personalised_note}</p>}
      {item.source_url && <p className="muted mt-2 text-[11px]">{t('source')}: <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="font-medium text-sky underline underline-offset-2">{item.source_name || item.source_url}</a></p>}
    </div>
  );
  const renderTipPlan = (plan: TipPlan) => (
    <div className="space-y-4"><div className="flex flex-wrap gap-2"><Chip tone={plan.generator === 'gemini' ? 'lavender' : 'blue'}>{plan.generator === 'gemini' ? 'Personalised guidance' : 'General guidance'}</Chip>{plan.focus.map((item) => <Chip key={item} tone="peach">{concernLabel(item, language)}</Chip>)}</div><div className="grid gap-4 lg:grid-cols-2">{[{ title: t('morning'), steps: plan.morning }, { title: t('night'), steps: plan.night }].map((section) => (<div key={section.title} className="rounded-2xl border border-line bg-[#fafbfe] p-4"><h3 className="font-semibold text-ink">{section.title}</h3><ol className="mt-3 space-y-3">{section.steps.map((step, i) => (<li key={`${step.title}-${i}`} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-powder text-[11px] font-bold text-ink">{i + 1}</span><div><p className="text-sm font-semibold text-ink">{step.title}</p><p className="muted text-xs">{step.detail}</p></div></li>))}</ol></div>))}</div><p className="muted text-xs">{plan.notice}</p></div>
  );
  const renderDietPlan = (plan: DietPlan) => (
    <div className="space-y-4"><div className="flex flex-wrap gap-2"><Chip tone={plan.generator === 'gemini' ? 'lavender' : 'blue'}>{plan.generator === 'gemini' ? 'Personalised guidance' : 'General guidance'}</Chip><Chip tone="green">{plan.hydration.target_ml} ml / day</Chip></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[[t('breakfast'), plan.breakfast], [t('lunch'), plan.lunch], [t('snacks'), plan.snacks], [t('dinner'), plan.dinner]].map(([title, items]) => (<div key={String(title)} className="rounded-2xl border border-line bg-[#fafbfe] p-4"><h3 className="font-semibold text-ink">{title}</h3><ul className="mt-2 space-y-1 text-xs text-ink/80">{(items as string[]).map((item) => <li key={item}>? {item}</li>)}</ul></div>))}</div><p className="muted text-xs">{plan.notice}</p></div>
  );

  return (
    <div>
      <SectionHeading eyebrow="Integrated analysis" title={t('navSkinDiseaseAnalysis')} subtitle={t('skinDiseaseIntro')} action={<Chip tone="lavender">Single workflow</Chip>} />

      <Card>
        <ImageUploader preview={preview} onSelect={(f, url) => { setFile(f); setPreview(url); setResult(null); setError(null); setRecommendations(null); setRecommendationsError(null); }} onClear={() => { setFile(null); setPreview(null); setResult(null); setError(null); setRecommendations(null); setRecommendationsError(null); }} label={t('chooseImage')} hint={t('uploadHint')} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={run} loading={loading} disabled={!file}><ScanFace size={16} /> {loading ? t('loading') : t('analyzeNow')}</Button>
          <label className="flex items-center gap-2 text-xs text-muted">{t('confidenceThreshold')}<input type="range" min={0.05} max={0.95} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="w-28 accent-[#243B63]" /><span className="w-9 font-semibold text-ink">{confidence.toFixed(2)}</span></label>
        </div>
        {error && <div className="mt-4"><ErrorBlock message={error} onRetry={file ? run : undefined} /></div>}
      </Card>

      {loading && !result && <div className="mt-6"><Card><LoadingBlock label={t('loading')} /></Card></div>}

      {result && <div className="mt-8 space-y-6">
        <Card>
          <SectionHeading eyebrow="1" title={t('predictedSkinCondition')} subtitle="Image-based estimate. Not a diagnosis." />
          {condition ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-2xl font-semibold text-ink">{condition.primary_condition.label}</p>
                  {condition.status === 'uncertain' && condition.primary_condition.top_label && <p className="muted mt-1 text-sm">{t('conditionUncertain')}: {condition.primary_condition.top_label}</p>}
                </div>
                <Chip tone={condition.status === 'classified' ? 'green' : 'peach'}>{condition.status === 'classified' ? t('conditionSelected') : t('conditionUncertain')}</Chip>
              </div>
              <p className="text-sm text-ink/85">{condition.summary}</p>
              <div className="flex flex-wrap gap-2">
                {condition.predictions.map((item) => (
                  <Chip key={item.id} tone={item.selected ? 'green' : 'neutral'}>{item.label}{item.selected ? ` · ${t('conditionSelected')}` : ''}</Chip>
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-powder/60 px-4 py-3 text-xs font-medium text-[#243B63]">{t('conditionModelUnavailable')}</p>
          )}
        </Card>

        <Card>
          <SectionHeading eyebrow="2" title={t('facialRegionAnalysis')} subtitle="Five-region facial skin measurements from the uploaded photo." />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <RegionMap analysis={result.analysis} imageSrc={preview} selected={selectedRegion} onSelect={setSelectedRegion} />
            <div className="space-y-2">{result.analysis.regions.map((region) => (<button key={region.id} onClick={() => setSelectedRegion(region.id)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selectedRegion === region.id ? 'border-sky/40 bg-powder/40' : 'border-transparent hover:border-line hover:bg-white'}`}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: regionColor(region) }} /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{region.label}</span><span className="block text-[11px] text-muted">{concernLabel(region.primary_concern, language)} ? {severityLabel(region.severity, language)}</span></span><span className="w-9 text-right text-sm font-bold text-ink">{region.score}</span></button>))}</div>
          </div>
          {activeRegion && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(activeRegion.metrics).map(([k, v]) => (<div key={k} className="rounded-xl border border-line bg-[#fafbfe] p-2.5"><p className="text-[11px] capitalize text-muted">{k}</p><p className="text-sm font-semibold text-ink">{v}</p></div>))}</div>}
        </Card>

        {hasLesionResults && detection && (
          <Card>
            <SectionHeading eyebrow="3" title={t('acneLesionDetection')} subtitle="Only findings detected in the uploaded photo are shown." />
            <div className="space-y-3">
              <Chip tone="blue">{detection.total_detections} {t('lesions')}</Chip>
              <LesionMap detection={detection} imageSrc={preview} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(detection.lesion_counts).filter(([, count]) => count > 0).map(([label, count]) => (<div key={label} className="rounded-xl border border-line bg-[#fafbfe] p-2.5"><p className="text-[11px] text-muted">{label}</p><p className="text-lg font-bold text-ink">{count}</p></div>))}</div>
              {detection.image_quality.warnings.length > 0 && <p className="text-xs text-[#243B63]">{detection.image_quality.warnings.join(' ')}</p>}
            </div>
          </Card>
        )}
        {!hasLesionResults && (
          <p className="rounded-xl border border-line bg-powder/60 px-4 py-3 text-xs font-medium text-[#243B63]">
            {detection ? t('detectionNoLesions') : t('detectionUnavailable')}
          </p>
        )}

        <Card>
          <SectionHeading eyebrow={hasLesionResults ? '4' : '3'} title={t('personalizedRecommendations')} subtitle="Based on your profile, preferences, and analysis results. Educational only." />
          {recommendationsLoading && <LoadingBlock label={t('loading')} />}
          {recommendationsError && <ErrorBlock message={recommendationsError} onRetry={() => void loadRecommendations(result)} />}
          {recommendations && !recommendationsLoading && (
            <div className="space-y-6">
              <div><h3 className="mb-3 font-semibold text-ink">{t('navProducts')}</h3>{recommendations.products?.products?.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{recommendations.products.products.slice(0, 6).map(renderProduct)}</div> : <p className="text-sm text-muted">{t('noRecommendations')}</p>}</div>
              <div className="grid gap-6 xl:grid-cols-2">
                <div><h3 className="mb-3 font-semibold text-ink">Fruits</h3><div className="grid gap-4 md:grid-cols-2">{(recommendations.fruits?.items || []).slice(0, 4).map(renderProduce)}</div></div>
                <div><h3 className="mb-3 font-semibold text-ink">Vegetables</h3><div className="grid gap-4 md:grid-cols-2">{(recommendations.vegetables?.items || []).slice(0, 4).map(renderProduce)}</div></div>
              </div>
              <div><h3 className="mb-3 font-semibold text-ink">{t('navTips')}</h3>{recommendations.tips ? renderTipPlan(recommendations.tips) : <p className="text-sm text-muted">{recommendations.errors?.tips || 'Tips unavailable.'}</p>}</div>
              <div><h3 className="mb-3 font-semibold text-ink">{t('navDiet')}</h3>{recommendations.diet ? renderDietPlan(recommendations.diet) : <p className="text-sm text-muted">{recommendations.errors?.diet || 'Diet unavailable.'}</p>}</div>
            </div>
          )}
        </Card>

        <Disclaimer text={result.analysis.disclaimer} />
      </div>}
    </div>
  );
}
