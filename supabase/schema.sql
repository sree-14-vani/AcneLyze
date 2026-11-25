-- AcneLyze cloud schema
-- Run this in the Supabase SQL editor (or `supabase db push`) before enabling
-- VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in frontend/.env.local.
--
-- Every user-owned table has Row Level Security enabled. Policies restrict rows
-- to auth.uid(); no service-role key is ever used in the browser.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  skin_type text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Automatically create a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------
create table if not exists public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'hi', 'kn', 'te')),
  diet_type text not null default 'vegetarian'
    check (diet_type in ('vegetarian', 'vegan', 'eggetarian', 'non_vegetarian')),
  allergies text[] not null default '{}',
  skin_goals text[] not null default '{}',
  sensitivities text[] not null default '{}',
  current_routine text not null default '',
  weight_kg double precision,
  notifications jsonb not null default '{"morning":true,"night":true,"water":true,"meal":false,"routine":true}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.preferences enable row level security;
drop policy if exists "preferences_all_own" on public.preferences;
create policy "preferences_all_own" on public.preferences
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Analysis history (thumbnails only; full images are never persisted)
-- ---------------------------------------------------------------------------
create table if not exists public.analyses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  overall_score double precision not null default 0,
  concerns text[] not null default '{}',
  focus_regions text[] not null default '{}',
  regions jsonb not null default '[]'::jsonb,
  thumbnail text,
  created_at timestamptz not null default now()
);
create index if not exists analyses_user_created_idx on public.analyses (user_id, created_at desc);

alter table public.analyses enable row level security;
drop policy if exists "analyses_all_own" on public.analyses;
create policy "analyses_all_own" on public.analyses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Enhancement history
-- ---------------------------------------------------------------------------
create table if not exists public.enhancements (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null default '',
  mode_label text not null default '',
  strength integer not null default 0,
  original_thumbnail text,
  enhanced_thumbnail text,
  notes text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists enhancements_user_created_idx on public.enhancements (user_id, created_at desc);

alter table public.enhancements enable row level security;
drop policy if exists "enhancements_all_own" on public.enhancements;
create policy "enhancements_all_own" on public.enhancements
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Saved beauty tips and diet plans (newest record wins in the UI)
-- ---------------------------------------------------------------------------
create table if not exists public.beauty_tips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists beauty_tips_user_created_idx on public.beauty_tips (user_id, created_at desc);

create table if not exists public.diet_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists diet_plans_user_created_idx on public.diet_plans (user_id, created_at desc);

alter table public.beauty_tips enable row level security;
alter table public.diet_plans enable row level security;
drop policy if exists "beauty_tips_all_own" on public.beauty_tips;
create policy "beauty_tips_all_own" on public.beauty_tips
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "diet_plans_all_own" on public.diet_plans;
create policy "diet_plans_all_own" on public.diet_plans
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Routine plan (one row per user)
-- ---------------------------------------------------------------------------
create table if not exists public.routines (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.routines enable row level security;
drop policy if exists "routines_all_own" on public.routines;
create policy "routines_all_own" on public.routines
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('medicine', 'self_monitoring')),
  title text not null default '',
  times text[] not null default '{}',
  repeat text not null check (repeat in ('never', 'daily', 'weekly', 'custom')),
  weekdays integer[] not null default '{}',
  custom_dates text[] not null default '{}',
  enabled boolean not null default true,
  next_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reminders_user_created_idx on public.reminders (user_id, created_at desc);

alter table public.reminders enable row level security;
drop policy if exists "reminders_all_own" on public.reminders;
create policy "reminders_all_own" on public.reminders
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.reminder_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  title text not null default '',
  category text not null default '',
  notified_at timestamptz not null default now()
);
create index if not exists reminder_notifications_user_idx on public.reminder_notifications (user_id, notified_at desc);
alter table public.reminder_notifications enable row level security;
drop policy if exists "reminder_notifications_all_own" on public.reminder_notifications;
create policy "reminder_notifications_all_own" on public.reminder_notifications
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- * Anon users cannot read or write any of these tables.
-- * Chat messages are never stored in the database; they go straight to the
--   backend AI proxy.
-- * Run `select * from pg_policies where schemaname = 'public';` to verify RLS.
