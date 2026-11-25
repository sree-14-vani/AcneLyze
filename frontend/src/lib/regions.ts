import type { AnalysisResult, Language, SkinRegion, VisibleAnalysis } from '../types';

export const REGION_COLORS: Record<string, string> = {
  forehead: '#7052a8',
  left_cheek: '#4a86c4',
  right_cheek: '#e8895e',
  nose: '#5aa6a0',
  chin: '#b07ba8',
};

export const CONCERN_COLORS: Record<string, string> = {
  redness: '#e07b6a',
  breakouts: '#e8895e',
  texture: '#7052a8',
  shine: '#4a86c4',
  balanced: '#5aa6a0',
};

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  hi: 'हिन्दी',
  kn: 'ಕನ್ನಡ',
  te: 'తెలుగు',
};

export const CONCERN_LABELS: Record<string, Record<Language, string>> = {
  redness: { en: 'Redness', hi: 'लालिमा', kn: 'ಕೆಂಪು', te: 'ఎరుపు' },
  breakouts: { en: 'Breakouts', hi: 'दाने', kn: 'ಮೊಡವೆ', te: 'మొటిమలు' },
  texture: { en: 'Texture', hi: 'बनावट', kn: 'ರಚನೆ', te: 'అల్లిక' },
  shine: { en: 'Shine', hi: 'चमक', kn: 'ಹೊಳಪು', te: 'మెరుపు' },
  balanced: { en: 'Balanced', hi: 'संतुलित', kn: 'ಸಮತೋಲಿತ', te: 'సమతుల్యం' },
};

export const SEVERITY_LABELS: Record<string, Record<Language, string>> = {
  low: { en: 'Low', hi: 'कम', kn: 'ಕಡಿಮೆ', te: 'తక్కువ' },
  mild: { en: 'Mild', hi: 'हल्का', kn: 'ಸ್ವಲ್ಪ', te: 'తేలిక' },
  moderate: { en: 'Moderate', hi: 'मध्यम', kn: 'ಮಧ್ಯಮ', te: 'మధ్యస్థ' },
  notable: { en: 'Notable', hi: 'उल्लेखनीय', kn: 'ಗಮನಾರ್ಹ', te: 'గమనార్హ' },
};

export function severityFromScore(score: number): string {
  if (score >= 80) return 'low';
  if (score >= 65) return 'mild';
  if (score >= 50) return 'moderate';
  return 'notable';
}

export function regionColor(region: SkinRegion): string {
  return REGION_COLORS[region.id] || '#7052a8';
}

const SUPPORTED_CONCERNS = new Set(['redness', 'breakouts', 'texture', 'shine', 'balanced']);
const SUPPORTED_FOCUS_REGIONS = new Set([
  'forehead',
  'left_cheek',
  'right_cheek',
  'nose',
  'chin',
]);

export function toVisibleAnalysis(result: AnalysisResult | Partial<AnalysisResult>): VisibleAnalysis {
  const concerns = (result.concerns || []).filter((item) => SUPPORTED_CONCERNS.has(item));
  const focus_regions = (result.focus_regions || []).filter((item) =>
    SUPPORTED_FOCUS_REGIONS.has(item),
  );
  const regions = (result.regions || [])
    .filter((region) => SUPPORTED_FOCUS_REGIONS.has(region.id))
    .slice(0, 5)
    .map((region) => ({
      id: region.id,
      score: region.score,
      concerns: [...new Set((region.concerns || []).filter((item) => SUPPORTED_CONCERNS.has(item)))].slice(0, 5),
      metrics: {
        redness: region.metrics?.redness ?? 50,
        breakouts: region.metrics?.breakouts ?? 50,
        texture: region.metrics?.texture ?? 50,
        shine: region.metrics?.shine ?? 50,
      },
      ...(typeof region.spots_detected === 'number' ? { spots_detected: region.spots_detected } : {}),
    }));
  return {
    ...(typeof result.overall_score === 'number' ? { overall_score: result.overall_score } : {}),
    concerns: [...new Set(concerns)].slice(0, 5),
    focus_regions: [...new Set(focus_regions)].slice(0, 5),
    regions,
  };
}

export function concernLabel(key: string, language: Language): string {
  return CONCERN_LABELS[key]?.[language] || CONCERN_LABELS[key]?.en || key;
}

export function severityLabel(key: string, language: Language): string {
  return SEVERITY_LABELS[key]?.[language] || SEVERITY_LABELS[key]?.en || key;
}
