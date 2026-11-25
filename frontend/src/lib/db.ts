import { supabase } from './supabase';
import type {
  AnalysisRecord,
  EnhancementRecord,
  Language,
  PlanRecord,
  Preferences,
  Profile,
  Reminder,
  RoutinePlan,
} from '../types';

const PREFIX = 'acneclear:';

export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const defaultPreferences: Preferences = {
  language: 'en',
  diet_type: 'vegetarian',
  allergies: [],
  skin_goals: [],
  sensitivities: [],
  current_routine: '',
  weight_kg: null,
  notifications: { morning: true, night: true, water: true, meal: false, routine: false },
};

function keyFor(part: string, userId: string): string { return `${PREFIX}${userId}:${part}`; }
function readLocal<T>(part: string, userId: string, fallback: T): T {
  try { const raw = localStorage.getItem(keyFor(part, userId)); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeLocal<T>(part: string, userId: string, value: T): void {
  try { localStorage.setItem(keyFor(part, userId), JSON.stringify(value)); }
  catch { throw new Error('Browser storage is full. Remove old history items and try again.'); }
}

export async function makeThumbnail(source: string, maxWidth = 420, quality = 0.72): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, maxWidth / image.width);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function mapAnalysis(row: Record<string, unknown>): AnalysisRecord {
  return {
    id: String(row.id), user_id: String(row.user_id), overall_score: Number(row.overall_score),
    concerns: (row.concerns as string[]) || [], focus_regions: (row.focus_regions as string[]) || [],
    regions: (row.regions as any[]) || [], thumbnail: (row.thumbnail as string) || null, created_at: String(row.created_at),
  };
}
function mapEnhancement(row: Record<string, unknown>): EnhancementRecord {
  return {
    id: String(row.id), user_id: String(row.user_id), method: String(row.method || ''), mode_label: String(row.mode_label || ''),
    strength: Number(row.strength || 0), original_thumbnail: (row.original_thumbnail as string) || null,
    enhanced_thumbnail: (row.enhanced_thumbnail as string) || null, notes: (row.notes as string[]) || [], created_at: String(row.created_at),
  };
}

function normalizeReminder(raw: Partial<Reminder> & Record<string, unknown>, userId: string): Reminder {
  const now = new Date().toISOString();
  const category = raw.category === 'medicine' ? 'medicine' : 'self_monitoring';
  const repeat = (['never', 'daily', 'weekly', 'custom'] as const).includes(raw.repeat as Reminder['repeat']) ? (raw.repeat as Reminder['repeat']) : 'daily';
  const times = Array.isArray(raw.times) ? raw.times.filter((t): t is string => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t)).sort() : [];
  const weekdays = Array.isArray(raw.weekdays) ? raw.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  const custom_dates = Array.isArray(raw.custom_dates) ? raw.custom_dates.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), user_id: userId, category,
    title: typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '',
    times: times.length ? Array.from(new Set(times)) : ['08:00'], repeat,
    weekdays: repeat === 'weekly' ? Array.from(new Set(weekdays)).sort((a,b)=>a-b) : [],
    custom_dates: repeat === 'custom' ? Array.from(new Set(custom_dates)).sort() : [],
    enabled: raw.enabled !== false,
    next_at: typeof raw.next_at === 'string' ? raw.next_at : null,
    last_notified_at: typeof raw.last_notified_at === 'string' ? raw.last_notified_at : null,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : now,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : now,
  };
}

export function computeNextReminderAt(reminder: Pick<Reminder, 'times' | 'repeat' | 'weekdays' | 'custom_dates' | 'enabled'>, after = new Date()): string | null {
  if (!reminder.enabled) return null;
  const times = Array.from(new Set(reminder.times)).filter((t) => /^\d{2}:\d{2}$/.test(t)).sort();
  if (!times.length) return null;
  const now = new Date(after); now.setSeconds(0, 0);
  const candidates: Date[] = [];
  const pushIfFuture = (d: Date) => { if (d.getTime() > now.getTime()) candidates.push(d); };
  if (reminder.repeat === 'daily' || reminder.repeat === 'never') {
    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
      const base = new Date(now); base.setDate(now.getDate() + dayOffset);
      for (const t of times) { const [h, m] = t.split(':').map(Number); const c = new Date(base); c.setHours(h, m, 0, 0); pushIfFuture(c); }
      if (reminder.repeat === 'never' && candidates.length) break;
    }
  } else if (reminder.repeat === 'weekly') {
    const days = new Set(reminder.weekdays);
    for (let dayOffset = 0; dayOffset < 15; dayOffset++) {
      const base = new Date(now); base.setDate(now.getDate() + dayOffset);
      if (days.size && !days.has(base.getDay())) continue;
      for (const t of times) { const [h, m] = t.split(':').map(Number); const c = new Date(base); c.setHours(h, m, 0, 0); pushIfFuture(c); }
    }
  } else if (reminder.repeat === 'custom') {
    for (const ds of reminder.custom_dates) {
      for (const t of times) {
        const [y, mo, d] = ds.split('-').map(Number); const [h, m] = t.split(':').map(Number);
        pushIfFuture(new Date(y, (mo || 1) - 1, d || 1, h || 0, m || 0, 0, 0));
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0].toISOString();
}

export function defaultReminders(_userId: string): Reminder[] { return []; }
async function apiReminders() { const { api } = await import('./api'); return api; }

export interface Repository {
  getProfile(userId: string, email: string, name: string): Promise<Profile>;
  updateProfile(userId: string, patch: Partial<Profile>): Promise<Profile>;
  getPreferences(userId: string): Promise<Preferences>;
  updatePreferences(userId: string, patch: Partial<Preferences>): Promise<Preferences>;
  listAnalyses(userId: string): Promise<AnalysisRecord[]>;
  addAnalysis(record: AnalysisRecord): Promise<void>;
  deleteAnalysis(userId: string, id: string): Promise<void>;
  listEnhancements(userId: string): Promise<EnhancementRecord[]>;
  addEnhancement(record: EnhancementRecord): Promise<void>;
  deleteEnhancement(userId: string, id: string): Promise<void>;
  getPlan<T>(userId: string, name: 'tips' | 'diet'): Promise<PlanRecord<T> | null>;
  listPlans<T>(userId: string, name: 'tips' | 'diet'): Promise<PlanRecord<T>[]>;
  savePlan<T>(userId: string, name: 'tips' | 'diet', plan: T): Promise<PlanRecord<T>>;
  deletePlan(userId: string, name: 'tips' | 'diet', id: string): Promise<void>;
  getRoutine(userId: string): Promise<RoutinePlan | null>;
  saveRoutine(userId: string, routine: RoutinePlan): Promise<void>;
  getReminders(userId: string): Promise<Reminder[]>;
  saveReminders(userId: string, reminders: Reminder[]): Promise<void>;
}

const localRepository: Repository = {
  async getProfile(userId, email, name) { const saved = readLocal<Profile | null>('profile', userId, null); return saved || { id: userId, full_name: name || email.split('@')[0], avatar_url: null }; },
  async updateProfile(userId, patch) { const current = await this.getProfile(userId, '', patch.full_name || ''); const next = { ...current, ...patch, id: userId, updated_at: new Date().toISOString() }; writeLocal('profile', userId, next); return next; },
  async getPreferences(userId) { return { ...defaultPreferences, ...readLocal<Partial<Preferences>>('preferences', userId, {}) }; },
  async updatePreferences(userId, patch) { const next = { ...(await this.getPreferences(userId)), ...patch }; writeLocal('preferences', userId, next); return next; },
  async listAnalyses(userId) { return readLocal<AnalysisRecord[]>('analyses', userId, []); },
  async addAnalysis(record) { writeLocal('analyses', record.user_id, [record, ...(await this.listAnalyses(record.user_id))].slice(0, 40)); },
  async deleteAnalysis(userId, id) { writeLocal('analyses', userId, (await this.listAnalyses(userId)).filter((i) => i.id !== id)); },
  async listEnhancements(userId) { return readLocal<EnhancementRecord[]>('enhancements', userId, []); },
  async addEnhancement(record) { writeLocal('enhancements', record.user_id, [record, ...(await this.listEnhancements(record.user_id))].slice(0, 30)); },
  async deleteEnhancement(userId, id) { writeLocal('enhancements', userId, (await this.listEnhancements(userId)).filter((i) => i.id !== id)); },
  async getPlan(userId, name) { return readLocal<PlanRecord<unknown> | null>(name, userId, null) as PlanRecord<never> | null; },
  async listPlans<T>(userId: string, name: 'tips' | 'diet'): Promise<PlanRecord<T>[]> { const history = readLocal<PlanRecord<unknown>[]>(`history:${name}`, userId, []); if (history.length) return history as PlanRecord<T>[]; const latest = await this.getPlan(userId, name); return latest ? [latest as PlanRecord<T>] : []; },
  async savePlan(userId, name, plan) { const record = { id: crypto.randomUUID(), user_id: userId, plan, created_at: new Date().toISOString() }; const history = readLocal<PlanRecord<unknown>[]>(`history:${name}`, userId, []); writeLocal(name, userId, record); writeLocal(`history:${name}`, userId, [record, ...history].slice(0, 30)); return record; },
  async deletePlan(userId, name, id) { const history = await this.listPlans(userId, name); writeLocal(`history:${name}`, userId, history.filter((item) => item.id !== id)); const latest = readLocal<PlanRecord<unknown> | null>(name, userId, null); if (latest?.id === id) writeLocal(name, userId, history.find((item) => item.id !== id) || null); },
  async getRoutine(userId) { return readLocal<RoutinePlan | null>('routine', userId, null); },
  async saveRoutine(userId, routine) { writeLocal('routine', userId, routine); },
  async getReminders(userId) {
    try { const api = await apiReminders(); const res = await api.reminders.list(); return (res.items || []).map((r) => normalizeReminder(r as any, userId)); }
    catch { const saved = readLocal<Reminder[]>('reminders', userId, []); return saved.map((r) => normalizeReminder(r as any, userId)); }
  },
  async saveReminders(userId, reminders) {
    const normalized = reminders.map((r) => normalizeReminder(r as any, userId));
    try {
      const api = await apiReminders(); const existing = await this.getReminders(userId);
      const existingIds = new Set(existing.map((r) => r.id)); const nextIds = new Set(normalized.map((r) => r.id));
      for (const r of normalized) { if (existingIds.has(r.id)) await api.reminders.update(r.id, r); else await api.reminders.create(r); }
      for (const id of existingIds) { if (!nextIds.has(id)) await api.reminders.remove(id); }
    } catch { writeLocal('reminders', userId, normalized); }
  },
};

function requireSupabase() {
  if (!supabase) throw new Error('Cloud sync is not configured.');
  return supabase;
}

const supabaseRepository: Repository = {
  async getProfile(userId, email, name) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('profiles')
      .select('id, full_name, avatar_url, updated_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Profile;
    const fallback: Profile = {
      id: userId,
      full_name: name || email.split('@')[0],
      avatar_url: null,
    };
    await client.from('profiles').upsert({
      id: userId,
      full_name: fallback.full_name,
      updated_at: new Date().toISOString(),
    });
    return fallback;
  },
  async updateProfile(userId, patch) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('profiles')
      .upsert({
        id: userId,
        full_name: patch.full_name,
        avatar_url: patch.avatar_url ?? null,
        skin_type: patch.skin_type ?? null,
        updated_at: new Date().toISOString(),
      })
      .select('id, full_name, avatar_url, skin_type, updated_at')
      .single();
    if (error) throw error;
    return data as Profile;
  },
  async getPreferences(userId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return defaultPreferences;
    const row = data as Record<string, unknown>;
    return {
      ...defaultPreferences,
      language: (row.language as Language) || 'en',
      diet_type: (row.diet_type as Preferences['diet_type']) || 'vegetarian',
      allergies: (row.allergies as string[]) || [],
      skin_goals: (row.skin_goals as string[]) || [],
      sensitivities: (row.sensitivities as string[]) || [],
      current_routine: String(row.current_routine || ''),
      weight_kg: row.weight_kg == null ? null : Number(row.weight_kg),
      notifications: {
        ...defaultPreferences.notifications,
        ...((row.notifications as Partial<Preferences['notifications']>) || {}),
      },
    };
  },
  async updatePreferences(userId, patch) {
    const client = requireSupabase();
    const current = await this.getPreferences(userId);
    const next = { ...current, ...patch };
    const { error } = await client.from('preferences').upsert({
      user_id: userId,
      language: next.language,
      diet_type: next.diet_type,
      allergies: next.allergies,
      skin_goals: next.skin_goals,
      sensitivities: next.sensitivities,
      current_routine: next.current_routine,
      weight_kg: next.weight_kg,
      notifications: next.notifications,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return next;
  },
  async listAnalyses(userId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('analyses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) throw error;
    return ((data || []) as Record<string, unknown>[]).map(mapAnalysis);
  },
  async addAnalysis(record) {
    const { error } = await requireSupabase().from('analyses').insert({
      id: record.id,
      user_id: record.user_id,
      overall_score: record.overall_score,
      concerns: record.concerns,
      focus_regions: record.focus_regions,
      regions: record.regions,
      thumbnail: record.thumbnail,
      created_at: record.created_at,
    });
    if (error) throw error;
  },
  async deleteAnalysis(userId, id) {
    const { error } = await requireSupabase().from('analyses').delete().eq('user_id', userId).eq('id', id);
    if (error) throw error;
  },
  async listEnhancements(userId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('enhancements')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return ((data || []) as Record<string, unknown>[]).map(mapEnhancement);
  },
  async addEnhancement(record) {
    const { error } = await requireSupabase().from('enhancements').insert({
      id: record.id,
      user_id: record.user_id,
      method: record.method,
      mode_label: record.mode_label,
      strength: record.strength,
      original_thumbnail: record.original_thumbnail,
      enhanced_thumbnail: record.enhanced_thumbnail,
      notes: record.notes,
      created_at: record.created_at,
    });
    if (error) throw error;
  },
  async deleteEnhancement(userId, id) {
    const { error } = await requireSupabase().from('enhancements').delete().eq('user_id', userId).eq('id', id);
    if (error) throw error;
  },
  async getPlan(userId, name) {
    const client = requireSupabase();
    const table = name === 'tips' ? 'beauty_tips' : 'diet_plans';
    const { data, error } = await client
      .from(table)
      .select('id, user_id, plan, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as PlanRecord<never> | null;
  },
  async listPlans(userId, name) {
    const client = requireSupabase();
    const table = name === 'tips' ? 'beauty_tips' : 'diet_plans';
    const { data, error } = await client
      .from(table)
      .select('id, user_id, plan, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return (data || []) as PlanRecord<never>[];
  },
  async savePlan(userId, name, plan) {
    const client = requireSupabase();
    const table = name === 'tips' ? 'beauty_tips' : 'diet_plans';
    const { data, error } = await client
      .from(table)
      .insert({ user_id: userId, plan })
      .select('id, user_id, plan, created_at')
      .single();
    if (error) throw error;
    return data as PlanRecord<never>;
  },
  async deletePlan(userId, name, id) {
    const client = requireSupabase();
    const table = name === 'tips' ? 'beauty_tips' : 'diet_plans';
    const { error } = await client.from(table).delete().eq('user_id', userId).eq('id', id);
    if (error) throw error;
  },
  async getRoutine(userId) {
    const client = requireSupabase();
    const { data, error } = await client.from('routines').select('plan').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data ? ((data as { plan: RoutinePlan }).plan || null) : null;
  },
  async saveRoutine(userId, routine) {
    const { error } = await requireSupabase().from('routines').upsert({
      user_id: userId,
      plan: routine,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
  async getReminders(userId) {
    try {
      const api = await apiReminders();
      const res = await api.reminders.list();
      return (res.items || []).map((r) => normalizeReminder(r as any, userId));
    } catch {
      const client = requireSupabase();
      const { data, error } = await client.from('reminders').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) throw error;
      return ((data || []) as Record<string, unknown>[]).map((r) => normalizeReminder(r as any, userId));
    }
  },
  async saveReminders(userId, reminders) {
    const normalized = reminders.map((r) => normalizeReminder(r as any, userId));
    try {
      const api = await apiReminders();
      const existing = await this.getReminders(userId);
      const existingIds = new Set(existing.map((r) => r.id));
      const nextIds = new Set(normalized.map((r) => r.id));
      for (const r of normalized) {
        if (existingIds.has(r.id)) await api.reminders.update(r.id, r);
        else await api.reminders.create(r);
      }
      for (const id of existingIds) { if (!nextIds.has(id)) await api.reminders.remove(id); }
      return;
    } catch {
      // fallback local cache only if backend unavailable
      writeLocal('reminders', userId, normalized);
    }
  },
};

export const repository: Repository = supabase ? supabaseRepository : localRepository;

export function newId(): string {
  return crypto.randomUUID();
}
