import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, BellRing, CheckCircle2, Info, Loader2, Sparkles, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../lib/i18n';

export function Logo({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-ink text-white shadow-sm">
        <Sparkles size={18} strokeWidth={2.2} />
      </div>
      <div className="leading-tight">
        <div className="font-display text-lg font-semibold tracking-[-0.01em] text-ink">AcneLyze</div>
        {!compact && (
          <div className="mt-0.5 max-w-[210px] text-[9px] font-medium leading-snug text-muted">
            {t('tagline')}
          </div>
        )}
      </div>
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  loading = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'soft' | 'ghost';
  loading?: boolean;
}) {
  const styles = {
    primary: 'btn-primary',
    soft: 'btn-soft',
    ghost: 'btn-ghost',
  }[variant];
  return (
    <button className={`${styles} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
  soft = false,
}: {
  children: ReactNode;
  className?: string;
  soft?: boolean;
}) {
  return <section className={`${soft ? 'card-soft' : 'card'} ${className}`}>{children}</section>;
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-coral">
            {eyebrow}
          </div>
        )}
        <h1 className="section-title">{title}</h1>
        {subtitle && <p className="muted mt-2 max-w-2xl text-[13px]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ChatMarkdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let key = 0;
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;

  const inline = (text: string): ReactNode[] =>
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={index} className="rounded bg-powder px-1 py-0.5 font-mono text-[12px] text-ink">{part.slice(1, -1)}</code>;
      }
      return <span key={index}>{part}</span>;
    });

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join('\n');
    paragraph = [];
    blocks.push(
      <p key={key++} className="whitespace-pre-line text-[13px] leading-6 text-ink/90">
        {inline(text)}
      </p>,
    );
  };

  const flushList = () => {
    if (!list) return;
    const current = list;
    list = null;
    const items = current.items.map((item, index) => <li key={index}>{item}</li>);
    blocks.push(
      current.ordered ? (
        <ol key={key++} className="ml-5 list-decimal space-y-1 text-[13px] leading-6 text-ink/90">
          {items}
        </ol>
      ) : (
        <ul key={key++} className="ml-5 list-disc space-y-1 text-[13px] leading-6 text-ink/90">
          {items}
        </ul>
      ),
    );
  };

  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);

    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(line.indexOf(' '), 4);
      const Heading = level <= 2 ? 'h2' : 'h3';
      blocks.push(
        <Heading key={key++} className={`font-display font-semibold text-ink ${level <= 2 ? 'text-[15px]' : 'text-[13px]'}`}>
          {inline(heading[1])}
        </Heading>,
      );
      continue;
    }

    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const itemText = (numbered || bullet)?.[1] || line;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(inline(itemText));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return <div className="space-y-2.5">{blocks}</div>;
}

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="animate-spin text-sky" size={26} />
      {label && <p className="muted">{label}</p>}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 shrink-0 text-rose-500" size={18} />
        <p className="text-sm leading-relaxed text-rose-900">{message}</p>
      </div>
      {onRetry && (
        <Button variant="soft" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, detail }: { icon?: ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/60 p-6 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-powder/60 text-sky">
        {icon || <Info size={20} />}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {detail && <p className="muted mt-1.5 max-w-sm">{detail}</p>}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  const visible = toasts.filter(
    (toast, index) => toasts.findIndex((item) => item.message === toast.message) === index,
  );
  if (!visible.length) return null;
  return (
    <div className="pointer-events-none fixed top-6 left-4 right-4 z-[200] flex flex-col gap-3 sm:left-auto sm:right-6 sm:w-[min(440px,calc(100vw-2rem))]">
      {visible.map((toast) => {
        const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertCircle : BellRing;
        return (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className="toast-slide-down pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-white p-4 shadow-card"
          >
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-powder text-ink">
              <Icon size={18} strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold leading-tight text-ink">{toast.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{toast.message}</p>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-powder hover:text-ink"
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function Disclaimer({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-peach/70 bg-peach/30 p-3.5">
      <Info size={16} className="mt-0.5 shrink-0 text-coral" />
      <p className="text-xs leading-relaxed text-ink/80">{text}</p>
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'blue' | 'lavender' | 'peach' | 'green';
}) {
  const tones = {
    neutral: 'border-line bg-white text-muted',
    blue: 'border-sky/25 bg-powder text-sky',
    lavender: 'border-line bg-powder text-ink',
    peach: 'border-coral/30 bg-peach text-coral',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
  return <span className={`pill ${tones[tone]}`}>{children}</span>;
}

export function SafeImage({
  src,
  alt,
  className = '',
  fallbackLabel = 'Image unavailable',
}: {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}) {
  const [broken, setBroken] = useState(false);
  const safeSrc = src?.trim();
  if (!safeSrc || broken) {
    return (
      <div className={`flex items-center justify-center bg-powder/50 text-xs font-medium text-muted ${className}`}>
        <span className="px-3 text-center">{fallbackLabel}</span>
      </div>
    );
  }
  return (
    <img
      src={safeSrc}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setBroken(true)}
    />
  );
}
