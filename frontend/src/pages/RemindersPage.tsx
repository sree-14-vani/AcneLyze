import { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, Calendar, ChevronDown, Clock, Pencil, Pill, Plus, Trash2, X, Activity } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { computeNextReminderAt } from '../lib/db';
import type { Reminder, ReminderCategory, ReminderRepeat, ReminderNotificationLog } from '../types';
import { Button, Card, SectionHeading } from '../components/UI';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const emptyForm = (): Partial<Reminder> & { times: string[]; weekdays: number[]; custom_dates: string[] } => ({
  category: 'medicine',
  title: '',
  times: ['08:00'],
  repeat: 'daily',
  weekdays: [],
  custom_dates: [],
  enabled: true,
});

function fmtNext(iso: string | null | undefined) {
  if (!iso) return 'Not scheduled';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not scheduled';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function repeatLabel(r: Reminder) {
  if (r.repeat === 'never') return 'Once';
  if (r.repeat === 'daily') return 'Daily';
  if (r.repeat === 'weekly') return r.weekdays.length ? `Weekly (${r.weekdays.map((d) => WEEKDAYS[d]).join(', ')})` : 'Weekly';
  if (r.repeat === 'custom') return r.custom_dates.length ? `Custom (${r.custom_dates.length} date${r.custom_dates.length > 1 ? 's' : ''})` : 'Custom';
  return r.repeat;
}

export default function RemindersPage() {
  const { reminders, saveReminders, pushToast, notificationPermission, requestNotifications } = useApp();
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<ReminderNotificationLog[]>([]);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(notificationPermission);

  useEffect(() => { setPerm(notificationPermission); }, [notificationPermission]);
  useEffect(() => {
    api.reminders.notifications(20).then((r) => setLogs(r.items || [])).catch(() => {});
  }, [reminders]);

  const sorted = useMemo(() => [...reminders].sort((a, b) => (a.enabled === b.enabled ? (a.next_at || '').localeCompare(b.next_at || '') : a.enabled ? -1 : 1)), [reminders]);

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setView('form'); };
  const openEdit = (r: Reminder) => {
    setEditingId(r.id);
    setForm({ category: r.category, title: r.title, times: [...r.times], repeat: r.repeat, weekdays: [...r.weekdays], custom_dates: [...r.custom_dates], enabled: r.enabled });
    setView('form');
  };

  const setCategory = (category: ReminderCategory) => setForm((f) => ({ ...f, category, title: f.title || '' }));
  const updateTime = (idx: number, value: string) => setForm((f) => ({ ...f, times: f.times.map((t, i) => i === idx ? value : t) }));
  const addTime = () => setForm((f) => ({ ...f, times: [...f.times, '08:00'] }));
  const removeTime = (idx: number) => setForm((f) => ({ ...f, times: f.times.filter((_, i) => i !== idx) }));
  const toggleWeekday = (day: number) => setForm((f) => ({ ...f, weekdays: f.weekdays.includes(day) ? f.weekdays.filter((d) => d !== day) : [...f.weekdays, day].sort((a,b)=>a-b) }));

  const submit = async () => {
    if (saving) return;
    const title = (form.title || '').trim();
    if (!title) { pushToast('Title is required.', 'error'); return; }
    const times = Array.from(new Set((form.times || []).filter((t) => /^\d{2}:\d{2}$/.test(t)))).sort();
    if (!times.length) { pushToast('Select at least one time.', 'error'); return; }
    const repeat = (form.repeat || 'daily') as ReminderRepeat;
    if (repeat === 'weekly' && !(form.weekdays || []).length) { pushToast('Select at least one weekday.', 'error'); return; }
    if (repeat === 'custom' && !(form.custom_dates || []).length) { pushToast('Select at least one date.', 'error'); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const base: Reminder = {
        id: editingId || crypto.randomUUID(),
        user_id: reminders[0]?.user_id || 'local-user',
        category: (form.category || 'medicine') as ReminderCategory,
        title,
        times,
        repeat,
        weekdays: repeat === 'weekly' ? [...(form.weekdays || [])] : [],
        custom_dates: repeat === 'custom' ? [...(form.custom_dates || [])] : [],
        enabled: form.enabled !== false,
        next_at: null,
        last_notified_at: editingId ? reminders.find((r) => r.id === editingId)?.last_notified_at || null : null,
        created_at: editingId ? reminders.find((r) => r.id === editingId)?.created_at || now : now,
        updated_at: now,
      };
      base.next_at = computeNextReminderAt(base);
      const next = editingId ? reminders.map((r) => r.id === editingId ? base : r) : [base, ...reminders];
      await saveReminders(next);
      pushToast(editingId ? 'Reminder updated.' : 'Reminder set successfully.', 'success');
      setView('list');
      setEditingId(null);
      setForm(emptyForm());
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not save reminder.', 'error');
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (saving) return;
    setSaving(true);
    try { await saveReminders(reminders.filter((r) => r.id !== id)); pushToast('Reminder deleted.', 'success'); }
    catch (e) { pushToast(e instanceof Error ? e.message : 'Could not delete reminder.', 'error'); }
    finally { setSaving(false); }
  };

  const toggle = async (r: Reminder) => {
    if (saving) return;
    setSaving(true);
    try {
      const next = reminders.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled, next_at: computeNextReminderAt({ ...x, enabled: !x.enabled }), updated_at: new Date().toISOString() } : x);
      await saveReminders(next);
    } catch (e) { pushToast(e instanceof Error ? e.message : 'Could not update reminder.', 'error'); }
    finally { setSaving(false); }
  };

  const askPermission = async () => {
    await requestNotifications();
    if ('Notification' in window) setPerm(Notification.permission);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <SectionHeading
        eyebrow="AcneLyze AI"
        title={view === 'form' ? (editingId ? 'Edit Reminder' : 'Add Reminder') : 'Reminders & Notifications'}
        subtitle={view === 'form' ? 'Set a medicine or self-monitoring reminder with the schedule you need.' : 'Manage your reminders. Browser notifications work while AcneLyze is open in a browser tab; they are not guaranteed when the browser is fully closed without a push backend.'}
        action={view === 'list' ? <Button onClick={openNew}><Plus size={16} /> Add reminder</Button> : <Button variant="soft" onClick={() => { setView('list'); setEditingId(null); }}><X size={16} /> Cancel</Button>}
      />

      {view === 'list' && (
        <>
          <Card soft className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-powder text-primary"><Bell size={18} /></div>
                <div>
                  <p className="text-sm font-semibold text-ink">Browser notifications</p>
                  <p className="muted text-xs">{perm === 'granted' ? 'Permission granted. Notifications can appear while AcneLyze is open.' : perm === 'denied' ? 'Permission denied. Enable notifications in browser settings.' : perm === 'unsupported' ? 'Notifications are not supported in this browser.' : 'Permission not requested yet.'}</p>
                </div>
              </div>
              <Button variant="soft" onClick={() => void askPermission()} disabled={perm === 'granted' || perm === 'unsupported'}>{perm === 'granted' ? 'Granted' : 'Enable notifications'}</Button>
            </div>
          </Card>

          <div className="space-y-3">
            {sorted.length === 0 && <Card className="py-10 text-center"><p className="text-sm font-medium text-ink">No reminders yet</p><p className="muted mt-1 text-xs">Add a medicine or self-monitoring reminder to get started.</p></Card>}
            {sorted.map((r) => (
              <Card key={r.id} className="py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${r.category === 'medicine' ? 'bg-[#EAF1F8] text-[#243B63]' : 'bg-[#F3F5F8] text-[#243B63]'}`}>
                    {r.category === 'medicine' ? <Pill size={18} /> : <Activity size={18} />}
                  </div>
                  <div className="min-w-[220px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink">{r.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{r.enabled ? 'Active' : 'Inactive'}</span>
                      <span className="rounded-full bg-powder px-2 py-0.5 text-[11px] font-medium text-primary">{r.category === 'medicine' ? 'Medicine' : 'Self Monitoring'}</span>
                    </div>
                    <p className="muted mt-1 text-xs">{r.times.join(', ')} ? {repeatLabel(r)}</p>
                    <p className="muted mt-1 text-xs">Next: {fmtNext(r.next_at)}{r.last_notified_at ? ` ? Last notified: ${fmtNext(r.last_notified_at)}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void toggle(r)} className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink hover:bg-powder/60" aria-label={r.enabled ? 'Disable reminder' : 'Enable reminder'}>{r.enabled ? <BellOff size={14} /> : <Bell size={14} />}</button>
                    <button type="button" onClick={() => openEdit(r)} className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink hover:bg-powder/60" aria-label="Edit reminder"><Pencil size={14} /></button>
                    <button type="button" onClick={() => void remove(r.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50" aria-label="Delete reminder"><Trash2 size={14} /></button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card className="mt-5">
            <p className="text-sm font-semibold text-ink">Recent notifications</p>
            <p className="muted mt-1 text-xs">Last notified status is shown per reminder; recent in-app/browser notification events appear below.</p>
            <div className="mt-3 space-y-2">
              {logs.length === 0 && <p className="muted text-xs">No notification history yet.</p>}
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-xl bg-[#F3F5F8] px-3 py-2 text-xs">
                  <span className="font-medium text-ink">{l.title} <span className="muted font-normal">({l.category === 'medicine' ? 'Medicine' : 'Self Monitoring'})</span></span>
                  <span className="muted">{fmtNext(l.notified_at)}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {view === 'form' && (
        <div className="mx-auto max-w-3xl">
          <Card className="p-0 overflow-hidden">
            <div className="space-y-6 p-5 sm:p-6">
              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">Reminder Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['medicine', 'self_monitoring'] as const).map((cat) => {
                    const active = form.category === cat;
                    const Icon = cat === 'medicine' ? Pill : Activity;
                    return (
                      <button key={cat} type="button" onClick={() => setCategory(cat)} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${active ? 'border-[#5B8DEF] bg-[#EAF1F8] text-[#243B63]' : 'border-line bg-white text-muted hover:border-[#BFD0EA]'}`}>
                        <Icon size={16} /> {cat === 'medicine' ? 'Medicine' : 'Self Monitoring'}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">Title</label>
                <input className="field" value={form.title || ''} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder={form.category === 'medicine' ? 'Medicine name, tablet name' : 'Weight, Water Intake, Skin Condition, Acne Progress, Sleep'} maxLength={120} />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">Time</label>
                <div className="space-y-2">
                  {(form.times || []).map((time, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Clock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input type="time" className="field pl-9" value={time} onChange={(e) => updateTime(idx, e.target.value)} required />
                      </div>
                      {(form.times || []).length > 1 && <button type="button" onClick={() => removeTime(idx)} className="rounded-lg border border-line p-2 text-muted hover:bg-rose-50 hover:text-rose-600" aria-label="Remove time"><X size={15} /></button>}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addTime} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-dashed border-[#BFD0EA] px-3 py-2 text-sm font-medium text-[#243B63] hover:bg-[#EAF1F8]"><Plus size={15} /> Add Time</button>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">Repeat</label>
                <div className="relative">
                  <select className="field appearance-none pr-10" value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as ReminderRepeat }))}>
                    <option value="never">Never</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Custom</option>
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
                </div>

                {form.repeat === 'weekly' && (
                  <div className="mt-3">
                    <p className="muted mb-2 text-xs">Select weekdays</p>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day, idx) => {
                        const active = (form.weekdays || []).includes(idx);
                        return <button key={day} type="button" onClick={() => toggleWeekday(idx)} className={`rounded-full px-3 py-1.5 text-xs font-medium border ${active ? 'bg-[#243B63] text-white border-[#243B63]' : 'bg-white text-ink border-line hover:bg-powder/60'}`}>{day}</button>;
                      })}
                    </div>
                  </div>
                )}

                {form.repeat === 'custom' && (
                  <div className="mt-3">
                    <p className="muted mb-2 text-xs">Select dates from calendar</p>
                    <div className="relative max-w-xs">
                      <Calendar size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input type="date" className="field pl-9" onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        setForm((f) => ({ ...f, custom_dates: Array.from(new Set([...(f.custom_dates || []), v])).sort() }));
                        e.currentTarget.value = '';
                      }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(form.custom_dates || []).map((d) => (
                        <span key={d} className="inline-flex items-center gap-1 rounded-full bg-[#EAF1F8] px-3 py-1 text-xs text-[#243B63]">
                          {fmtNext(`${d}T00:00:00`)}
                          <button type="button" onClick={() => setForm((f) => ({ ...f, custom_dates: (f.custom_dates || []).filter((x) => x !== d) }))} aria-label={`Remove ${d}`}><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {form.repeat !== 'never' && (
                  <p className="muted mt-3 text-xs">Upcoming: {fmtNext(computeNextReminderAt({ times: form.times || [], repeat: (form.repeat || 'daily') as ReminderRepeat, weekdays: form.weekdays || [], custom_dates: form.custom_dates || [], enabled: true }))}</p>
                )}
              </div>
            </div>

            <div className="border-t border-line bg-white p-4 sm:p-5">
              <Button onClick={() => void submit()} loading={saving} className="w-full py-3 text-base"><Bell size={16} /> {editingId ? 'Save Changes' : 'Set Reminder'}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
