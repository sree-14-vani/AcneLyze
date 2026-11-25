import { useState } from 'react';
import { History as HistoryIcon, Sparkles, Trash2, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useApp } from '../context/AppContext';
import type { AnalysisRecord, DietPlan, EnhancementRecord, PlanRecord, TipPlan } from '../types';
import { Button, Card, Chip, EmptyState, SectionHeading } from '../components/UI';
import { concernLabel, regionColor } from '../lib/regions';

type Tab = 'analysis' | 'enhancement' | 'tips' | 'diet';

export default function HistoryPage() {
  const { t, language } = useI18n();
  const {
    analyses,
    enhancements,
    tipHistory,
    dietHistory,
    deleteAnalysis,
    deleteEnhancement,
    deletePlan,
    pushToast,
  } = useApp();
  const [tab, setTab] = useState<Tab>('analysis');
  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisRecord | null>(null);
  const [activeEnhancement, setActiveEnhancement] = useState<EnhancementRecord | null>(null);
  const [activeTip, setActiveTip] = useState<PlanRecord<TipPlan> | null>(null);
  const [activeDiet, setActiveDiet] = useState<PlanRecord<DietPlan> | null>(null);

  const removeAnalysis = async (record: AnalysisRecord) => {
    if (!window.confirm(`${t('delete')} ${new Date(record.created_at).toLocaleString()}?`)) return;
    await deleteAnalysis(record.id);
    pushToast(t('saved'), 'success');
  };

  const removeEnhancement = async (record: EnhancementRecord) => {
    if (!window.confirm(`${t('delete')} ${new Date(record.created_at).toLocaleString()}?`)) return;
    await deleteEnhancement(record.id);
    pushToast(t('saved'), 'success');
  };

  const removePlan = async (name: 'tips' | 'diet', record: PlanRecord<TipPlan> | PlanRecord<DietPlan>) => {
    if (!window.confirm(`${t('delete')} ${new Date(record.created_at).toLocaleString()}?`)) return;
    await deletePlan(name, record.id);
    pushToast(t('saved'), 'success');
  };

  return (
    <div>
      <SectionHeading eyebrow="Saved results" title={t('navHistory')} subtitle={t('overviewSub')} />

      <div className="mb-5 inline-flex rounded-xl border border-line bg-white p-1">
        {([
          { key: 'analysis' as Tab, label: t('analysisHistory'), count: analyses.length },
          { key: 'enhancement' as Tab, label: t('enhancementHistory'), count: enhancements.length },
          { key: 'tips' as Tab, label: t('tipsHistory'), count: tipHistory.length },
          { key: 'diet' as Tab, label: t('dietHistory'), count: dietHistory.length },
        ]).map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
              tab === item.key ? 'bg-powder text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {item.label} ({item.count})
          </button>
        ))}
      </div>

      {tab === 'analysis' && (
        analyses.length === 0 ? (
          <Card>
            <EmptyState icon={<HistoryIcon size={22} />} title={t('noHistory')} />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {analyses.map((record) => (
              <Card key={record.id} className="p-4">
                <div className="flex gap-3">
                  {record.thumbnail ? (
                    <img src={record.thumbnail} alt="" className="h-20 w-16 rounded-lg border border-line object-cover" />
                  ) : (
                    <div className="h-20 w-16 rounded-lg bg-powder/50" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-2xl font-semibold text-ink">{record.overall_score}</p>
                    <p className="muted text-[10px]">/ 100 · {t('overallScore')}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {record.concerns.slice(0, 2).map((concern) => (
                        <Chip key={concern} tone="peach">
                          {concernLabel(concern, language)}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="muted mt-3 text-[10px]">
                  {t('savedAt')} {new Date(record.created_at).toLocaleString()}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="soft" className="flex-1 py-1.5 text-xs" onClick={() => setActiveAnalysis(record)}>
                    {t('viewAnalysis')}
                  </Button>
                  <button
                    onClick={() => void removeAnalysis(record)}
                    className="rounded-xl border border-line p-2 text-muted hover:bg-rose-50 hover:text-rose-600"
                    aria-label={t('delete')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'enhancement' && (
        enhancements.length === 0 ? (
          <Card>
            <EmptyState icon={<Sparkles size={22} />} title={t('noHistory')} />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {enhancements.map((record) => (
              <Card key={record.id} className="p-4">
                <div className="flex gap-2">
                  {record.original_thumbnail && (
                    <img src={record.original_thumbnail} alt={t('original')} className="h-24 w-[45%] rounded-lg border border-line object-cover" />
                  )}
                  {record.enhanced_thumbnail && (
                    <img src={record.enhanced_thumbnail} alt={t('enhanced')} className="h-24 w-[45%] rounded-lg border border-line object-cover" />
                  )}
                </div>
                <p className="mt-3 truncate text-sm font-semibold text-ink">{record.mode_label || t('enhanced')}</p>
                <p className="muted text-[10px]">
                  {record.strength}% · {t('savedAt')} {new Date(record.created_at).toLocaleString()}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="soft" className="flex-1 py-1.5 text-xs" onClick={() => setActiveEnhancement(record)}>
                    {t('viewResult')}
                  </Button>
                  <button
                    onClick={() => void removeEnhancement(record)}
                    className="rounded-xl border border-line p-2 text-muted hover:bg-rose-50 hover:text-rose-600"
                    aria-label={t('delete')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'tips' && (
        tipHistory.length === 0 ? (
          <Card>
            <EmptyState icon={<Sparkles size={22} />} title={t('noHistory')} />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tipHistory.map((record) => (
              <Card key={record.id} className="p-4">
                <p className="font-display text-lg font-semibold text-ink">{t('navTips')}</p>
                <p className="muted text-[10px]">
                  {t('savedAt')} {new Date(record.created_at).toLocaleString()}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Chip tone={record.plan.generator === 'gemini' ? 'lavender' : 'blue'}>
                    {record.plan.generator === 'gemini' ? 'Personalised guidance' : 'General guidance'}
                  </Chip>
                  {record.plan.focus.slice(0, 3).map((item) => (
                    <Chip key={item} tone="peach">
                      {concernLabel(item, language)}
                    </Chip>
                  ))}
                </div>
                <p className="muted mt-3 text-xs">
                  {record.plan.morning.map((step) => step.title).join(' · ')}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="soft" className="flex-1 py-1.5 text-xs" onClick={() => setActiveTip(record)}>
                    {t('viewPlan')}
                  </Button>
                  <button
                    onClick={() => void removePlan('tips', record)}
                    className="rounded-xl border border-line p-2 text-muted hover:bg-rose-50 hover:text-rose-600"
                    aria-label={t('delete')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'diet' && (
        dietHistory.length === 0 ? (
          <Card>
            <EmptyState icon={<HistoryIcon size={22} />} title={t('noHistory')} />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dietHistory.map((record) => (
              <Card key={record.id} className="p-4">
                <p className="font-display text-lg font-semibold text-ink">{t('navDiet')}</p>
                <p className="muted text-[10px]">
                  {t('savedAt')} {new Date(record.created_at).toLocaleString()}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Chip tone={record.plan.generator === 'gemini' ? 'lavender' : 'blue'}>
                    {record.plan.generator === 'gemini' ? 'Personalised guidance' : 'General guidance'}
                  </Chip>
                  <Chip tone="green">
                    {(record.plan.hydration.target_ml / 1000).toFixed(1)} L
                  </Chip>
                </div>
                <p className="muted mt-3 text-xs">
                  {record.plan.avoid.length ? `${t('avoid')}: ${record.plan.avoid.join(', ')}` : record.plan.notes[0]}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="soft" className="flex-1 py-1.5 text-xs" onClick={() => setActiveDiet(record)}>
                    {t('viewPlan')}
                  </Button>
                  <button
                    onClick={() => void removePlan('diet', record)}
                    className="rounded-xl border border-line p-2 text-muted hover:bg-rose-50 hover:text-rose-600"
                    aria-label={t('delete')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {(activeAnalysis || activeEnhancement || activeTip || activeDiet) && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div className="scrollbar-thin max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-float sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-ink">
                {activeAnalysis
                  ? t('viewAnalysis')
                  : activeEnhancement
                    ? t('viewResult')
                    : activeTip
                      ? t('navTips')
                      : t('navDiet')}
              </h2>
              <button
                onClick={() => {
                  setActiveAnalysis(null);
                  setActiveEnhancement(null);
                  setActiveTip(null);
                  setActiveDiet(null);
                }}
                className="rounded-lg p-1.5 text-muted hover:bg-line"
                aria-label={t('close')}
              >
                <X size={18} />
              </button>
            </div>

            {activeAnalysis && (
              <div className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
                {activeAnalysis.thumbnail && (
                  <img src={activeAnalysis.thumbnail} alt="" className="h-fit w-full rounded-xl border border-line" />
                )}
                <div>
                  <p className="font-display text-3xl font-semibold text-ink">{activeAnalysis.overall_score}</p>
                  <p className="muted text-xs">{t('overallScore')}</p>
                  <div className="mt-4 space-y-2">
                    {activeAnalysis.regions.map((region) => (
                      <div key={region.id} className="flex items-center gap-3">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: regionColor(region) }} />
                        <span className="flex-1 text-sm text-ink">{region.label}</span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                          <span className="block h-full" style={{ width: `${region.score}%`, background: regionColor(region) }} />
                        </span>
                        <span className="w-8 text-right text-xs font-bold text-ink">{region.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeEnhancement && (
              <div className="grid gap-3 sm:grid-cols-2">
                <figure>
                  <img src={activeEnhancement.original_thumbnail || ''} alt={t('original')} className="w-full rounded-xl border border-line" />
                  <figcaption className="muted mt-1 text-center text-xs">{t('original')}</figcaption>
                </figure>
                <figure>
                  <img src={activeEnhancement.enhanced_thumbnail || ''} alt={t('enhanced')} className="w-full rounded-xl border border-line" />
                  <figcaption className="mt-1 text-center text-xs font-semibold text-plum">{t('enhanced')}</figcaption>
                </figure>
              </div>
            )}

            {activeTip && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1">
                  <Chip tone={activeTip.plan.generator === 'gemini' ? 'lavender' : 'blue'}>
                    {activeTip.plan.generator === 'gemini' ? 'Personalised guidance' : 'General guidance'}
                  </Chip>
                  {activeTip.plan.focus.map((item) => (
                    <Chip key={item} tone="peach">
                      {concernLabel(item, language)}
                    </Chip>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { title: t('morning'), steps: activeTip.plan.morning },
                    { title: t('night'), steps: activeTip.plan.night },
                  ].map((section) => (
                    <Card key={section.title} soft>
                      <h3 className="font-display text-lg font-semibold text-ink">{section.title}</h3>
                      <ol className="mt-3 space-y-2">
                        {section.steps.map((step, index) => (
                          <li key={`${step.title}-${index}`} className="text-sm text-ink/85">
                            {index + 1}. <strong>{step.title}</strong> — {step.detail}
                          </li>
                        ))}
                      </ol>
                    </Card>
                  ))}
                </div>
                {activeTip.plan.focus_notes.length > 0 && (
                  <Card>
                    <h3 className="font-display text-lg font-semibold text-ink">{t('focusAreas')}</h3>
                    <ul className="mt-2 space-y-1 text-sm text-ink/85">
                      {activeTip.plan.focus_notes.map((note, index) => (
                        <li key={index}>• {note}</li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            )}

            {activeDiet && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1">
                  <Chip tone={activeDiet.plan.generator === 'gemini' ? 'lavender' : 'blue'}>
                    {activeDiet.plan.generator === 'gemini' ? 'Personalised guidance' : 'General guidance'}
                  </Chip>
                  <Chip tone="green">
                    {(activeDiet.plan.hydration.target_ml / 1000).toFixed(1)} L
                  </Chip>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { title: t('breakfast'), items: activeDiet.plan.breakfast },
                    { title: t('lunch'), items: activeDiet.plan.lunch },
                    { title: t('snacks'), items: activeDiet.plan.snacks },
                    { title: t('dinner'), items: activeDiet.plan.dinner },
                  ].map((section) => (
                    <Card key={section.title} soft>
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-plum">
                        {section.title}
                      </p>
                      <ul className="mt-2 space-y-1 text-sm text-ink/85">
                        {section.items.map((item, index) => (
                          <li key={index}>• {item}</li>
                        ))}
                      </ul>
                    </Card>
                  ))}
                </div>
                {activeDiet.plan.notes.length > 0 && (
                  <Card>
                    <ul className="space-y-1 text-xs text-muted">
                      {activeDiet.plan.notes.map((note, index) => (
                        <li key={index}>• {note}</li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
