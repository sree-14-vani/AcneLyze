import { useState } from 'react';
import { CheckCircle2, FileDown } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useApp } from '../context/AppContext';
import { Button, Card, Disclaimer, ErrorBlock, SectionHeading } from '../components/UI';
import { severityFromScore } from '../lib/regions';
import type { DetectionResult, DietPlan, SkinConditionResult, SkinDiseaseAnalysisResult, TipPlan } from '../types';

function latestIntegrated(): SkinDiseaseAnalysisResult | null {
  try {
    const raw = localStorage.getItem('acneclear:latest-skin-disease-analysis');
    return raw ? (JSON.parse(raw) as SkinDiseaseAnalysisResult) : null;
  } catch { return null; }
}

function latestDetection(): DetectionResult | null {
  const integrated = latestIntegrated();
  if (integrated?.detection) return integrated.detection;
  try { const raw = localStorage.getItem('acneclear:latest-detection'); return raw ? (JSON.parse(raw) as DetectionResult) : null; } catch { return null; }
}

function latestCondition(): SkinConditionResult | null {
  const integrated = latestIntegrated();
  if (integrated?.condition) return integrated.condition;
  try { const raw = localStorage.getItem('acneclear:latest-skin-condition'); return raw ? (JSON.parse(raw) as SkinConditionResult) : null; } catch { return null; }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function ReportPage() {
  const { t } = useI18n();
  const { analyses, enhancements, latestDiet, latestTips, profile, preferences, pushToast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const scan = analyses[0] || null;
  const detection = latestDetection();
  const condition = latestCondition();
  const latestEnhancement = enhancements[0] || null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    setReady(false);
    try {
      const [products, fruits, vegetables] = await Promise.all([
        api.products({ skin_type: profile?.skin_type || 'combination', concerns: scan?.concerns || [], sensitivities: preferences.sensitivities || [] }),
        api.fruits(),
        api.vegetables(),
      ]);
      const payload: Record<string, unknown> = {
        scan: scan ? { created_at: scan.created_at, id: scan.id } : null,
        profile: { full_name: profile?.full_name || null, skin_type: profile?.skin_type || null },
        analysis: scan ? { overall_score: scan.overall_score, severity: severityFromScore(scan.overall_score), concerns: scan.concerns, focus_regions: scan.focus_regions } : null,
        condition: condition ? { status: condition.status, primary_condition: condition.primary_condition, predictions: condition.predictions, summary: condition.summary, disclaimer: condition.disclaimer } : null,
        detection: detection ? { method: detection.method, checkpoint: detection.checkpoint, summary: detection.summary, confidence_threshold: detection.confidence_threshold, total_detections: detection.total_detections, lesion_counts: detection.lesion_counts, class_explanations: detection.class_explanations, region_counts: detection.region_counts } : null,
        enhancement: latestEnhancement ? { method: latestEnhancement.method, mode_label: latestEnhancement.mode_label, strength: latestEnhancement.strength, face_detected: true, notes: latestEnhancement.notes, original_image: latestEnhancement.original_thumbnail, enhanced_image: latestEnhancement.enhanced_thumbnail, disclaimer: 'This is cosmetic image enhancement/restoration, not acne detection or medical treatment.' } : null,
        input: detection?.input || (scan ? { width: null, height: null, format: null, name: 'Latest saved scan' } : {}),
        products: products.products.slice(0, 8),
        fruits: fruits.items.slice(0, 8),
        vegetables: vegetables.items.slice(0, 8),
        diet: (latestDiet as DietPlan | null) || null,
        tips: (latestTips as TipPlan | null) || null,
      };
      const blob = await api.reportPdf(payload);
      downloadBlob(blob, `acnelyze-skin-report-${new Date().toISOString().slice(0, 10)}.pdf`);
      setReady(true);
      pushToast(t('reportReady'), 'success');
    } catch (caught) {
      setReady(false);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHeading eyebrow="AcneLyze AI" title={t('navReport')} subtitle={t('reportIntro')} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-[#fafbfe] p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Saved scan</p><p className="mt-1 text-sm font-semibold text-ink">{scan ? `${scan.overall_score}/100 • ${scan.created_at.slice(0, 10)}` : t('noScanForReport')}</p></div>
          <div className="rounded-xl border border-line bg-[#fafbfe] p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Predicted condition</p><p className="mt-1 text-sm font-semibold text-ink">{condition ? `${condition.primary_condition.label} • ${condition.status}` : 'Not available for this scan'}</p></div>
          <div className="rounded-xl border border-line bg-[#fafbfe] p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Detection</p><p className="mt-1 text-sm font-semibold text-ink">{detection ? `${detection.total_detections} lesions` : 'Not available for this scan'}</p></div>
          <div className="rounded-xl border border-line bg-[#fafbfe] p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Enhancement</p><p className="mt-1 text-sm font-semibold text-ink">{latestEnhancement ? `${latestEnhancement.mode_label} • ${latestEnhancement.strength}%` : 'Not available for this scan'}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={generate} loading={busy}><FileDown size={16} /> {busy ? t('loading') : t('generateReport')}</Button>
          {busy && <span className="text-xs text-muted">{t('loading')}</span>}
          {ready && !busy && <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 size={15} /> {t('reportReady')}</span>}
        </div>
        {error && <div className="mt-4"><ErrorBlock message={error} onRetry={generate} /></div>}
      </Card>
      <div className="mt-5"><Disclaimer text={t('disclaimer')} /></div>
    </div>
  );
}
