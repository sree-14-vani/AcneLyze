import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import {
  defaultPreferences,
  localDateString,
  makeThumbnail,
  newId,
  repository,
} from '../lib/db';
import type {
  AnalysisRecord,
  AnalysisResult,
  ApiConfig,
  DietPlan,
  EnhancementRecord,
  EnhancementResult,
  Language,
  Preferences,
  PlanRecord,
  Profile,
  Reminder,
  RoutinePlan,
  TipPlan,
} from '../types';

export interface Toast {
  id: string;
  title: string;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface AppValue {
  loading: boolean;
  profile: Profile | null;
  preferences: Preferences;
  analyses: AnalysisRecord[];
  enhancements: EnhancementRecord[];
  latestTips: TipPlan | null;
  latestDiet: DietPlan | null;
  tipHistory: PlanRecord<TipPlan>[];
  dietHistory: PlanRecord<DietPlan>[];
  routine: RoutinePlan | null;
  reminders: Reminder[];
  apiConfig: ApiConfig | null;
  apiConfigLoading: boolean;
  toasts: Toast[];
  notificationPermission: NotificationPermission | 'unsupported';
  pushToast: (message: string, tone?: Toast['tone'], title?: string) => void;
  dismissToast: (id: string) => void;
  refresh: () => Promise<void>;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  recordAnalysis: (result: AnalysisResult, source: string) => Promise<AnalysisRecord | null>;
  recordEnhancement: (
    result: EnhancementResult,
    originalSource: string,
  ) => Promise<EnhancementRecord | null>;
  saveTips: (plan: TipPlan) => Promise<void>;
  saveDiet: (plan: DietPlan) => Promise<void>;
  saveRoutine: (routine: RoutinePlan) => Promise<void>;
  saveReminders: (reminders: Reminder[]) => Promise<void>;
  deleteAnalysis: (id: string) => Promise<void>;
  deleteEnhancement: (id: string) => Promise<void>;
  deletePlan: (name: 'tips' | 'diet', id: string) => Promise<void>;
  requestNotifications: () => Promise<void>;
}

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { user, updateName } = useAuth();
  const { language, setLanguage } = useI18n();
  const languageRef = useRef(language);
  languageRef.current = language;

  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [enhancements, setEnhancements] = useState<EnhancementRecord[]>([]);
  const [latestTips, setLatestTips] = useState<TipPlan | null>(null);
  const [latestDiet, setLatestDiet] = useState<DietPlan | null>(null);
  const [tipHistory, setTipHistory] = useState<PlanRecord<TipPlan>[]>([]);
  const [dietHistory, setDietHistory] = useState<PlanRecord<DietPlan>[]>([]);
  const [routine, setRoutine] = useState<RoutinePlan | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [apiConfigLoading, setApiConfigLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >('unsupported');

  const pushToast = useCallback((message: string, tone: Toast['tone'] = 'info', title?: string) => {
    const id = newId();
    const resolvedTitle = title || (tone === 'success' ? 'Success' : tone === 'error' ? 'Action needed' : 'Reminder');
    setToasts((current) => [...current, { id, title: resolvedTitle, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 7000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    let active = true;
    api.config()
      .then((config) => {
        if (active) setApiConfig(config);
      })
      .catch(() => {
        // The UI shows an explicit backend status; no silent fake config.
      })
      .finally(() => {
        if (active) setApiConfigLoading(false);
      });
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setAnalyses([]);
      setEnhancements([]);
      setLatestTips(null);
      setLatestDiet(null);
      setTipHistory([]);
      setDietHistory([]);
      setRoutine(null);
      setReminders([]);
      return;
    }
    setLoading(true);
    try {
      const [nextProfile, nextPreferences, nextAnalyses, nextEnhancements, tips, diet, nextTipHistory, nextDietHistory, nextRoutine, nextReminders] =
        await Promise.all([
          repository.getProfile(user.id, user.email, user.name),
          repository.getPreferences(user.id),
          repository.listAnalyses(user.id),
          repository.listEnhancements(user.id),
          repository.getPlan<TipPlan>(user.id, 'tips'),
          repository.getPlan<DietPlan>(user.id, 'diet'),
          repository.listPlans<TipPlan>(user.id, 'tips'),
          repository.listPlans<DietPlan>(user.id, 'diet'),
          repository.getRoutine(user.id),
          repository.getReminders(user.id),
        ]);
      setProfile(nextProfile);
      setPreferences(nextPreferences);
      setAnalyses(nextAnalyses);
      setEnhancements(nextEnhancements);
      setLatestTips(tips?.plan || null);
      setLatestDiet(diet?.plan || null);
      setTipHistory(nextTipHistory);
      setDietHistory(nextDietHistory);
      setRoutine(nextRoutine);
      setReminders(nextReminders);
      if (nextPreferences.language !== languageRef.current) {
        setLanguage(nextPreferences.language);
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not load your data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [user, pushToast, setLanguage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updatePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      if (!user) return;
      const next = await repository.updatePreferences(user.id, patch);
      setPreferences(next);
      if (patch.language) setLanguage(patch.language);
    },
    [user, setLanguage],
  );

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      if (!user) return;
      const next = await repository.updateProfile(user.id, patch);
      setProfile(next);
      if (patch.full_name && patch.full_name !== user.name) {
        await updateName(patch.full_name);
      }
    },
    [user, updateName],
  );

  const recordAnalysis = useCallback(
    async (result: AnalysisResult, source: string) => {
      if (!user) return null;
      try {
        const thumbnail = await makeThumbnail(source);
        const record: AnalysisRecord = {
          id: newId(),
          user_id: user.id,
          overall_score: result.overall_score,
          concerns: result.concerns,
          focus_regions: result.focus_regions,
          regions: result.regions,
          thumbnail,
          created_at: new Date().toISOString(),
        };
        await repository.addAnalysis(record);
        setAnalyses((current) => [record, ...current].slice(0, 40));
        return record;
      } catch (error) {
        pushToast(error instanceof Error ? error.message : 'Could not save analysis.', 'error');
        return null;
      }
    },
    [user, pushToast],
  );

  const recordEnhancement = useCallback(
    async (result: EnhancementResult, originalSource: string) => {
      if (!user) return null;
      try {
        const [originalThumb, enhancedThumb] = await Promise.all([
          makeThumbnail(originalSource),
          makeThumbnail(result.image),
        ]);
        const record: EnhancementRecord = {
          id: newId(),
          user_id: user.id,
          method: result.method,
          mode_label: result.mode_label,
          strength: result.strength,
          original_thumbnail: originalThumb,
          enhanced_thumbnail: enhancedThumb,
          notes: result.notes,
          created_at: new Date().toISOString(),
        };
        await repository.addEnhancement(record);
        setEnhancements((current) => [record, ...current].slice(0, 30));
        return record;
      } catch (error) {
        pushToast(error instanceof Error ? error.message : 'Could not save enhancement.', 'error');
        return null;
      }
    },
    [user, pushToast],
  );

  const saveTips = useCallback(
    async (plan: TipPlan) => {
      if (!user) {
        setLatestTips(plan);
        return;
      }
      const record = await repository.savePlan(user.id, 'tips', plan);
      setLatestTips(plan);
      setTipHistory((current) => [record, ...current.filter((item) => item.id !== record.id)].slice(0, 30));
    },
    [user],
  );

  const saveDiet = useCallback(
    async (plan: DietPlan) => {
      if (!user) {
        setLatestDiet(plan);
        return;
      }
      const record = await repository.savePlan(user.id, 'diet', plan);
      setLatestDiet(plan);
      setDietHistory((current) => [record, ...current.filter((item) => item.id !== record.id)].slice(0, 30));
    },
    [user],
  );

  const saveRoutine = useCallback(
    async (routinePlan: RoutinePlan) => {
      if (!user) return;
      await repository.saveRoutine(user.id, routinePlan);
      setRoutine(routinePlan);
    },
    [user],
  );

  const saveReminders = useCallback(
    async (next: Reminder[]) => {
      if (!user) return;
      await repository.saveReminders(user.id, next);
      setReminders(next);
    },
    [user],
  );

  const deleteAnalysis = useCallback(
    async (id: string) => {
      if (!user) return;
      await repository.deleteAnalysis(user.id, id);
      setAnalyses((current) => current.filter((item) => item.id !== id));
    },
    [user],
  );

  const deleteEnhancement = useCallback(
    async (id: string) => {
      if (!user) return;
      await repository.deleteEnhancement(user.id, id);
      setEnhancements((current) => current.filter((item) => item.id !== id));
    },
    [user],
  );

  const deletePlan = useCallback(
    async (name: 'tips' | 'diet', id: string) => {
      if (!user) return;
      await repository.deletePlan(user.id, name, id);
      if (name === 'tips') {
        const next = tipHistory.filter((item) => item.id !== id);
        setTipHistory(next);
        setLatestTips(next[0]?.plan || null);
      } else {
        const next = dietHistory.filter((item) => item.id !== id);
        setDietHistory(next);
        setLatestDiet(next[0]?.plan || null);
      }
    },
    [user, tipHistory, dietHistory],
  );

  const requestNotifications = useCallback(async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setNotificationPermission(result);
  }, []);

  // Real reminder delivery while app/browser tab is open.
  const notificationsRef = useRef({ reminders });
  notificationsRef.current = { reminders };

  useEffect(() => {
    if (!user) return;
    const firedKey = `acneclear:reminders:fired:${user.id}`;
    let fired: Record<string, string> = {};
    try { fired = JSON.parse(localStorage.getItem(firedKey) || '{}') as Record<string, string>; } catch { fired = {}; }

    const tick = async () => {
      const now = new Date();
      now.setSeconds(0, 0);
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const today = localDateString(now);
      const { reminders: list } = notificationsRef.current;
      let changed = false;
      for (const reminder of list) {
        if (!reminder.enabled) continue;
        const dueTimes = reminder.times || [];
        const matchesTime = dueTimes.includes(hhmm);
        if (!matchesTime) continue;
        let matchesDay = false;
        if (reminder.repeat === 'daily') matchesDay = true;
        else if (reminder.repeat === 'never') matchesDay = true; // fire once at matching time; dedupe prevents repeats
        else if (reminder.repeat === 'weekly') matchesDay = reminder.weekdays.includes(now.getDay());
        else if (reminder.repeat === 'custom') matchesDay = reminder.custom_dates.includes(today);
        if (!matchesDay) continue;
        const fireId = `${reminder.id}:${today}:${hhmm}`;
        if (fired[fireId]) continue;
        fired[fireId] = new Date().toISOString();
        changed = true;
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            const n = new Notification('AcneLyze', { body: `${reminder.category === 'medicine' ? 'Medicine' : 'Self monitoring'}: ${reminder.title}`, tag: fireId, silent: false });
            n.onclick = () => { window.focus(); window.location.assign('/app/reminders'); };
          } catch { /* in-app fallback below */ }
        }
        pushToast(
          `${reminder.category === 'medicine' ? 'Medicine' : 'Self monitoring'} reminder is due now.`,
          'info',
          reminder.title,
        );
        try {
          const { api } = await import('../lib/api');
          const updated = await api.reminders.markNotified(reminder.id, new Date().toISOString());
          setReminders((curr) => curr.map((r) => (r.id === reminder.id ? updated : r)));
        } catch { /* keep local state; backend sync can retry */ }
      }
      if (changed) { try { localStorage.setItem(firedKey, JSON.stringify(fired)); } catch { /* ignore */ } }
    };

    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [user, pushToast]);

  const value = useMemo<AppValue>(
    () => ({
      loading,
      profile,
      preferences,
      analyses,
      enhancements,
      latestTips,
      latestDiet,
      tipHistory,
      dietHistory,
      routine,
      reminders,
      apiConfig,
      apiConfigLoading,
      toasts,
      notificationPermission,
      pushToast,
      dismissToast,
      refresh,
      updatePreferences,
      updateProfile,
      recordAnalysis,
      recordEnhancement,
      saveTips,
      saveDiet,
      saveRoutine,
      saveReminders,
      deleteAnalysis,
      deleteEnhancement,
      deletePlan,
      requestNotifications,
    }),
    [
      loading, profile, preferences, analyses, enhancements, latestTips, latestDiet,
      tipHistory, dietHistory, routine, reminders, apiConfig, apiConfigLoading, toasts,
      notificationPermission, pushToast, dismissToast, refresh, updatePreferences,
      updateProfile, recordAnalysis, recordEnhancement, saveTips, saveDiet, saveRoutine,
      saveReminders, deleteAnalysis, deleteEnhancement, deletePlan, requestNotifications,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}

export type { Language };
