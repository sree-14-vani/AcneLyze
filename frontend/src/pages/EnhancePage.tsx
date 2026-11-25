import { useState } from 'react';
import { CheckCircle2, Download, Loader2, RotateCcw, Sparkles, WandSparkles } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { toVisibleAnalysis } from '../lib/regions';
import { useI18n } from '../lib/i18n';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import type { EnhancementResult } from '../types';
import ImageUploader from '../components/ImageUploader';
import ImageCompare from '../components/ImageCompare';
import { Button, Card, Chip, Disclaimer, ErrorBlock, SectionHeading } from '../components/UI';

export default function EnhancePage() {
  const { t, language } = useI18n();
  const { recordEnhancement, saveTips, saveDiet, profile, preferences, pushToast } = useApp();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [strength, setStrength] = useState(35);
  const [result, setResult] = useState<EnhancementResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingPlans, setGeneratingPlans] = useState(false);
  const [plansReady, setPlansReady] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setSuccess(null);
    setError(null);
    setGeneratingPlans(false);
    setPlansReady(false);
    setPlanError(null);
  };

  const updateStrength = (value: number) => {
    const next = Math.max(5, Math.min(85, value));
    setStrength(next);
    if (file && result) {
      void run(next);
    }
  };

  const generatePlans = async (sourceFile: File) => {
    setGeneratingPlans(true);
    setPlanError(null);
    setPlansReady(false);
    try {
      // Analyse the same uploaded image, then send only supported visible
      // measurements to the backend for plan generation.
      const measurement = await api.analyze(sourceFile);
      const analysis = toVisibleAnalysis(measurement);
      const [tips, diet] = await Promise.all([
        api.tips({
          analysis,
          preferences: {
            skin_type: profile?.skin_type || 'combination',
            goals: preferences.skin_goals,
            sensitivities: preferences.sensitivities,
            current_routine: preferences.current_routine,
          },
          language,
        }),
        api.diet({
          analysis,
          preferences: {
            diet_type: preferences.diet_type,
            allergies: preferences.allergies,
            dislikes: [],
            weight_kg: preferences.weight_kg,
            meals_per_day: 4,
          },
          language,
        }),
      ]);
      await Promise.all([saveTips(tips), saveDiet(diet)]);
      setPlansReady(true);
    } catch (caught) {
      setPlanError(errorMessage(caught));
    } finally {
      setGeneratingPlans(false);
    }
  };

  const run = async (nextStrength = strength) => {
    if (!file) {
      setError(t('imageRequired'));
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await api.enhance(file, nextStrength);
      setResult(data);
      setSuccess('Enhancement complete. Cosmetic improvement only, not acne removal.');
      if (!result) void generatePlans(file);
      if (user) {
        setSaving(true);
        const record = await recordEnhancement(data, preview || '');
        if (record) pushToast(t('savedToAccount'), 'success');
      } else {
        pushToast(t('signInRequired'), 'info');
      }
    } catch (caught) {
      const message = errorMessage(caught);
      setError(
        message.includes('face') || message.includes('Face')
          ? `${t('faceNotFound')} ${message}`
          : message,
      );
    } finally {
      setSaving(false);
      setLoading(false);
    }
  };

  const download = async () => {
    if (!result) return;
    setDownloading(true);
    setError(null);
    try {
      // Convert the returned PNG data URL into a Blob for a genuine download.
      const response = await fetch(result.image);
      if (!response.ok) throw new Error('Could not read the enhanced PNG.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `acnelyze-enhanced-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <SectionHeading
        eyebrow="Natural facial restoration"
        title={t('navEnhance')}
        subtitle={t('uploadHint')}
        action={<Chip tone="blue">{t('supportedFormats')}</Chip>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <ImageUploader
            preview={preview}
            onSelect={(selectedFile, url) => {
              setFile(selectedFile);
              setPreview(url);
              setResult(null);
              setSuccess(null);
              setError(null);
            }}
            onClear={reset}
            label={t('chooseImage')}
          />
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-ink">
              <span>{t('strength')}</span>
              <span className="rounded-lg bg-powder px-2 py-0.5 text-plum">{strength}%</span>
            </div>
            <input
              type="range"
              min={5}
              max={85}
              value={strength}
              onChange={(event) => updateStrength(Number(event.target.value))}
              className="w-full accent-plum"
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>5%</span>
              <span>85%</span>
            </div>
            <p className="muted mt-1 text-[10px]">
              Adjusts restoration strength and conservative cosmetic softening. It does not remove acne medically.
            </p>
          </div>
          <Button onClick={() => void run(strength)} loading={loading} disabled={!file} className="mt-5 w-full py-3">
            <WandSparkles size={17} /> {loading ? t('loading') : t('enhanceNow')}
          </Button>
          {saving && <p className="mt-2 text-center text-xs text-muted">{t('saved')}…</p>}
          {generatingPlans && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted">
              <Loader2 size={13} className="animate-spin" /> {t('generatingPlans')}
            </p>
          )}
          {plansReady && !generatingPlans && (
            <p className="mt-2 text-center text-xs text-emerald-700">{t('plansReady')}</p>
          )}
          {error && (
            <div className="mt-4">
              <ErrorBlock message={error} onRetry={file ? () => void run(strength) : undefined} />
            </div>
          )}
          {planError && (
            <div className="mt-4">
              <ErrorBlock
                message={`${t('planGenerationFailed')} ${planError}`}
                onRetry={file ? () => void generatePlans(file) : undefined}
              />
            </div>
          )}
        </Card>

        <div className="space-y-5">
          {!result ? (
            <Card className="flex min-h-[320px] flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lavender/60 text-plum">
                <Sparkles size={24} />
              </div>
              <p className="mt-4 font-display text-lg font-semibold text-ink">{t('result')}</p>
              <p className="muted mt-2 max-w-xs">{t('uploadHint')}</p>
            </Card>
          ) : (
            <>
              <Card>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold text-ink">{t('beforeAfter')}</h2>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip tone="lavender">{result.mode_label}</Chip>
                    <Chip tone="blue">{result.processing_ms} ms</Chip>
                    {result.gfpgan_weight !== undefined && (
                      <Chip tone="blue">weight {result.gfpgan_weight.toFixed(2)}</Chip>
                    )}
                  </div>
                </div>
                {success && (
                  <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 size={16} /> {success}
                  </p>
                )}
                {preview && <ImageCompare original={preview} enhanced={result.image} />}
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <figure>
                    <img
                      src={preview || ''}
                      alt={t('original')}
                      className="aspect-[4/5] w-full rounded-xl border border-line bg-powder/20 object-contain"
                    />
                    <figcaption className="mt-1.5 text-center text-xs font-medium text-muted">
                      {t('original')}
                    </figcaption>
                  </figure>
                  <figure>
                    <img
                      src={result.image}
                      alt={t('enhanced')}
                      className="aspect-[4/5] w-full rounded-xl border border-line bg-powder/20 object-contain"
                    />
                    <figcaption className="mt-1.5 text-center text-xs font-medium text-plum">
                      {t('enhanced')}
                    </figcaption>
                  </figure>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Button onClick={download} loading={downloading}>
                    <Download size={16} /> {t('download')}
                  </Button>
                  <Button variant="soft" onClick={reset}>
                    <RotateCcw size={16} /> {t('uploadAnother')}
                  </Button>
                </div>
              </Card>

              <Card soft>
                <p className="text-xs leading-relaxed text-ink/80">{result.disclaimer}</p>
                {result.notes.map((note) => (
                  <p key={note} className="muted mt-2 text-xs">
                    • {note}
                  </p>
                ))}
              </Card>
            </>
          )}
          <Disclaimer text={t('disclaimer')} />
        </div>
      </div>
    </div>
  );
}
