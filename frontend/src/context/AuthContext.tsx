import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { setApiUserId } from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'account_exists'
  | 'user_not_found'
  | 'invalid_code'
  | 'weak_password'
  | 'invalid_email'
  | 'generic';

export class AuthFailure extends Error {
  code: AuthErrorCode;
  constructor(code: AuthErrorCode, message?: string) {
    super(message || code);
    this.code = code;
  }
}

interface AuthValue {
  user: AuthUser | null;
  ready: boolean;
  mode: 'supabase' | 'demo';
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<string | null>;
  confirmReset: (email: string, code: string, password: string) => Promise<void>;
  updateName: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

interface DemoUser {
  id: string;
  email: string;
  name: string;
  salt: string;
  passwordHash: string;
  resetHash?: string;
  resetExpiry?: number;
}

const USERS_KEY = 'acneclear:demo:users';
const SESSION_KEY = 'acneclear:demo:session';

function readDemoUsers(): DemoUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]') as DemoUser[];
  } catch {
    return [];
  }
}

function writeDemoUsers(users: DemoUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

async function hashValue(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function mapSupabaseError(error: { message?: string }): AuthFailure {
  const message = error.message || '';
  if (/invalid login|credentials/i.test(message)) return new AuthFailure('invalid_credentials');
  if (/already registered|already exists|duplicate/i.test(message)) return new AuthFailure('account_exists');
  if (/user not found/i.test(message)) return new AuthFailure('user_not_found');
  return new AuthFailure('generic', message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setApiUserId(user?.id ?? null); }, [user]);

  useEffect(() => {
    let active = true;
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        const sessionUser = data.session?.user;
        setUser(
          sessionUser
            ? {
                id: sessionUser.id,
                email: sessionUser.email || '',
                name: String(sessionUser.user_metadata?.full_name || sessionUser.email || ''),
              }
            : null,
        );
        setReady(true);
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        const sessionUser = session?.user;
        setUser(
          sessionUser
            ? {
                id: sessionUser.id,
                email: sessionUser.email || '',
                name: String(sessionUser.user_metadata?.full_name || sessionUser.email || ''),
              }
            : null,
        );
      });
      return () => {
        active = false;
        listener.subscription.unsubscribe();
      };
    }

    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
    setReady(true);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!validEmail(email)) throw new AuthFailure('invalid_email');
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw mapSupabaseError(error);
      return;
    }
    const account = readDemoUsers().find((item) => item.email === email.trim().toLowerCase());
    if (!account) throw new AuthFailure('invalid_credentials');
    const hash = await hashValue(`${account.salt}:${password}`);
    if (hash !== account.passwordHash) throw new AuthFailure('invalid_credentials');
    const nextUser = { id: account.id, email: account.email, name: account.name };
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setApiUserId(nextUser.id);
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    if (!validEmail(email)) throw new AuthFailure('invalid_email');
    if (password.length < 8) throw new AuthFailure('weak_password');
    if (supabase) {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() } },
      });
      if (error) throw mapSupabaseError(error);
      if (!data.session) {
        // Email confirmation is enabled; the user must verify before sign-in.
        throw new AuthFailure('generic', 'Check your email to confirm your account, then sign in.');
      }
      return;
    }
    const users = readDemoUsers();
    const normalised = email.trim().toLowerCase();
    if (users.some((item) => item.email === normalised)) throw new AuthFailure('account_exists');
    const salt = crypto.randomUUID();
    const account: DemoUser = {
      id: crypto.randomUUID(),
      email: normalised,
      name: name.trim() || normalised.split('@')[0],
      salt,
      passwordHash: await hashValue(`${salt}:${password}`),
    };
    writeDemoUsers([...users, account]);
    const nextUser = { id: account.id, email: account.email, name: account.name };
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setApiUserId(nextUser.id);
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
    setUser(null);
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<string | null> => {
    if (!validEmail(email)) throw new AuthFailure('invalid_email');
    if (supabase) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw mapSupabaseError(error);
      return null;
    }
    const users = readDemoUsers();
    const index = users.findIndex((item) => item.email === email.trim().toLowerCase());
    if (index < 0) throw new AuthFailure('user_not_found');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    users[index].resetHash = await hashValue(code);
    users[index].resetExpiry = Date.now() + 15 * 60 * 1000;
    writeDemoUsers(users);
    return code;
  }, []);

  const confirmReset = useCallback(async (email: string, code: string, password: string) => {
    if (password.length < 8) throw new AuthFailure('weak_password');
    if (supabase) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw mapSupabaseError(error);
      return;
    }
    const users = readDemoUsers();
    const index = users.findIndex((item) => item.email === email.trim().toLowerCase());
    if (index < 0) throw new AuthFailure('user_not_found');
    const account = users[index];
    if (!account.resetHash || account.resetHash !== (await hashValue(code.trim()))) {
      throw new AuthFailure('invalid_code');
    }
    if (!account.resetExpiry || account.resetExpiry < Date.now()) {
      throw new AuthFailure('invalid_code', 'This code has expired. Request a new one.');
    }
    account.passwordHash = await hashValue(`${account.salt}:${password}`);
    delete account.resetHash;
    delete account.resetExpiry;
    users[index] = account;
    writeDemoUsers(users);
  }, []);

  const updateName = useCallback(async (name: string) => {
    if (!user) return;
    if (supabase) {
      const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
      if (error) throw mapSupabaseError(error);
    } else {
      const users = readDemoUsers();
      const index = users.findIndex((item) => item.id === user.id);
      if (index >= 0) {
        users[index].name = name.trim();
        writeDemoUsers(users);
      }
      const nextUser = { ...user, name: name.trim() };
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
      setUser(nextUser);
    }
  }, [user]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      ready,
      mode: supabaseConfigured ? 'supabase' : 'demo',
      configured: supabaseConfigured,
      signIn,
      signUp,
      signOut,
      resetPassword,
      confirmReset,
      updateName,
    }),
    [user, ready, signIn, signUp, signOut, resetPassword, confirmReset, updateName],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
