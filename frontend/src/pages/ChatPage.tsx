import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Mic, Send, Sparkles, Square, UserRound } from 'lucide-react';

import { api, ApiError, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useApp } from '../context/AppContext';
import type { ChatTurn, DetectionResult } from '../types';
import { Button, Card, ChatMarkdown, Chip, Disclaimer, SectionHeading } from '../components/UI';

interface SpeechResultLike {
  isFinal: boolean;
  0?: { transcript: string };
}

interface SpeechEventLike {
  resultIndex?: number;
  results: ArrayLike<SpeechResultLike>;
}

interface SpeechErrorLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SubmitLike = { preventDefault: () => void };

const SPEECH_LOCALES = { en: 'en-US', hi: 'hi-IN', kn: 'kn-IN', te: 'te-IN' } as const;
const HISTORY_KEY = 'acneclear:chat-history';

function isPermissionDenied(error: unknown): boolean {
  const name =
    error instanceof DOMException
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';
  return ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name);
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
}

function latestDetection(): DetectionResult | null {
  try {
    const raw = localStorage.getItem('acneclear:latest-detection');
    return raw ? (JSON.parse(raw) as DetectionResult) : null;
  } catch {
    return null;
  }
}

function loadHistory(): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatTurn[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item &&
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.content === 'string' &&
          item.content.trim(),
      )
      .slice(-24);
  } catch {
    return [];
  }
}

function chatErrorMessage(caught: unknown, t: (key: string) => string): string {
  if (!(caught instanceof ApiError)) return errorMessage(caught);
  if (caught.code === 'gemini_not_configured') return t('chatUnavailable');
  if (caught.code === 'timeout' || caught.code === 'gemini_timeout') return t('chatTimeout');
  if (
    caught.code === 'network_error' ||
    caught.code === 'gemini_unreachable' ||
    caught.code === 'gemini_unavailable'
  ) {
    return t('chatConnection');
  }
  if (
    caught.code === 'gemini_invalid_response' ||
    caught.code === 'gemini_empty' ||
    caught.code === 'gemini_blocked'
  ) {
    return t('chatInvalid');
  }
  return caught.message || t('error');
}

export default function ChatPage() {
  const { t, language } = useI18n();
  const { apiConfig, analyses, latestDiet, latestTips, preferences, profile, routine } = useApp();
  const [messages, setMessages] = useState<ChatTurn[]>(loadHistory);
  const [input, setInput] = useState('');
  const [interimText, setInterimText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const [useContext, setUseContext] = useState(true);
  const [listening, setListening] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const listeningRef = useRef(false);
  const requestingMicRef = useRef(false);
  const processingRef = useRef(false);
  const sessionRef = useRef(0);
  const baseInputRef = useRef('');
  const finalPartsRef = useRef<Map<number, string>>(new Map());
  const interimRef = useRef('');
  const finalReceivedRef = useRef(false);
  const recognitionErrorRef = useRef(false);
  const permissionStreamRef = useRef<MediaStream | null>(null);

  const ready = apiConfig !== null;
  const geminiEnabled = apiConfig?.features.gemini_chat === true;
  const statusLabel = !apiConfig
    ? 'Offline'
    : geminiEnabled
      ? t('geminiOn')
      : t('geminiOff');
  const statusTone = !apiConfig ? 'peach' : geminiEnabled ? 'green' : 'peach';
  const recognitionSupported = getSpeechRecognition() !== null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
    } catch {
      void 0;
    }
  }, [messages]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          void 0;
        }
        recognitionRef.current = null;
      }
      permissionStreamRef.current?.getTracks().forEach((track) => track.stop());
      permissionStreamRef.current = null;
      listeningRef.current = false;
      requestingMicRef.current = false;
      processingRef.current = false;
    };
  }, []);

  const clearRecognition = (recognition: SpeechRecognitionLike | null) => {
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  };

  const releaseMic = () => {
    permissionStreamRef.current?.getTracks().forEach((track) => track.stop());
    permissionStreamRef.current = null;
  };

  const setVoiceMessage = (message: string | null, denied = false) => {
    if (!mountedRef.current) return;
    setVoiceError(message);
    setPermissionDenied(denied);
  };

  const finishListening = (recognition: SpeechRecognitionLike, session: number, ended = false) => {
    if (sessionRef.current !== session || recognitionRef.current !== recognition) return;
    sessionRef.current += 1;
    clearRecognition(recognition);
    recognitionRef.current = null;
    releaseMic();
    const hadError = recognitionErrorRef.current;
    const hadFinal = finalReceivedRef.current;
    const pending = interimRef.current.trim();
    if (ended && !hadFinal && pending && mountedRef.current) {
      const base = baseInputRef.current;
      setInput(base ? `${base}${base.endsWith(' ') ? '' : ' '}${pending}` : pending);
    }
    listeningRef.current = false;
    requestingMicRef.current = false;
    processingRef.current = false;
    interimRef.current = '';
    finalReceivedRef.current = false;
    recognitionErrorRef.current = false;
    if (mountedRef.current) {
      setListening(false);
      setRequestingMic(false);
      setProcessingVoice(false);
      setInterimText('');
    }
    if (ended && !hadFinal && !pending && !hadError && mountedRef.current) {
      setVoiceMessage(t('voiceNoSpeech'));
    }
  };

  const stopListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      sessionRef.current += 1;
      releaseMic();
      listeningRef.current = false;
      requestingMicRef.current = false;
      processingRef.current = false;
      interimRef.current = '';
      if (mountedRef.current) {
        setListening(false);
        setRequestingMic(false);
        setProcessingVoice(false);
        setInterimText('');
      }
      return;
    }
    processingRef.current = true;
    if (mountedRef.current) setProcessingVoice(true);
    try {
      recognition.stop();
    } catch {
      recognitionErrorRef.current = true;
      finishListening(recognition, sessionRef.current);
      setVoiceMessage(t('voiceError'));
    }
  };

  const startListening = async () => {
    const Constructor = getSpeechRecognition();
    setVoiceMessage(null);
    if (!Constructor) {
      setVoiceMessage(t('voiceUnsupported'));
      return;
    }
    if (listeningRef.current || recognitionRef.current || requestingMicRef.current || processingRef.current) return;
    if (busyRef.current) return;

    const session = sessionRef.current + 1;
    sessionRef.current = session;
    baseInputRef.current = input;
    finalPartsRef.current = new Map();
    interimRef.current = '';
    finalReceivedRef.current = false;
    recognitionErrorRef.current = false;
    requestingMicRef.current = true;
    if (mountedRef.current) {
      setInterimText('');
      setRequestingMic(true);
    }

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (sessionRef.current !== session || !mountedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        permissionStreamRef.current = stream;
      } catch (caught) {
        requestingMicRef.current = false;
        if (mountedRef.current) setRequestingMic(false);
        const denied = isPermissionDenied(caught);
        setVoiceMessage(denied ? t('voicePermissionDenied') : t('voiceMicError'), denied);
        return;
      }
    }

    if (sessionRef.current !== session || !mountedRef.current) return;
    requestingMicRef.current = false;
    if (mountedRef.current) setRequestingMic(false);

    const recognition = new Constructor();
    recognition.lang = SPEECH_LOCALES[language];
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      if (
        !mountedRef.current ||
        sessionRef.current !== session ||
        recognitionRef.current !== recognition
      ) {
        return;
      }
      const startIndex = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
      const interimParts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        if (index < startIndex) continue;
        const result = event.results[index];
        const transcript = result[0]?.transcript?.trim() || '';
        if (!transcript) continue;
        if (result.isFinal) {
          finalPartsRef.current.set(index, transcript);
          finalReceivedRef.current = true;
        } else if (!finalReceivedRef.current) {
          interimParts.push(transcript);
        }
      }
      const finalText = [...finalPartsRef.current.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, transcript]) => transcript)
        .join(' ')
        .trim();
      if (finalText) {
        processingRef.current = true;
        if (mountedRef.current) setProcessingVoice(true);
        const base = baseInputRef.current;
        setInput(base ? `${base}${base.endsWith(' ') ? '' : ' '}${finalText}` : finalText);
        interimRef.current = '';
        setInterimText('');
        return;
      }
      if (!finalReceivedRef.current) {
        const text = interimParts.join(' ').trim();
        interimRef.current = text;
        setInterimText(text);
      }
    };
    recognition.onerror = (event) => {
      if (sessionRef.current !== session || recognitionRef.current !== recognition) return;
      recognitionErrorRef.current = true;
      finishListening(recognition, session);
      if (!mountedRef.current || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setVoiceMessage(t('voicePermissionDenied'), true);
      } else if (event.error === 'no-speech') {
        setVoiceMessage(t('voiceNoSpeech'));
      } else {
        setVoiceMessage(t('voiceError'));
      }
    };
    recognition.onend = () => finishListening(recognition, session, true);
    recognitionRef.current = recognition;
    listeningRef.current = true;
    if (mountedRef.current) setListening(true);

    try {
      recognition.start();
    } catch {
      recognitionErrorRef.current = true;
      finishListening(recognition, session);
      setVoiceMessage(t('voiceError'));
    }
  };

  const send = async (event?: SubmitLike, options?: { text?: string; retry?: boolean }) => {
    event?.preventDefault();
    const text = (options?.text ?? input).trim();
    if (
      !text ||
      !ready ||
      busy ||
      busyRef.current ||
      listeningRef.current ||
      requestingMicRef.current ||
      processingRef.current
    ) {
      return;
    }

    busyRef.current = true;
    const history = messages.slice(-23);
    const next: ChatTurn[] = options?.retry
      ? history
      : [...history, { role: 'user', content: text }];
    setMessages(next);
    if (!options?.retry) {
      setInput('');
      setInterimText('');
    }
    setBusy(true);
    setError(null);
    setFailedText(null);

    try {
      const analysis = useContext && analyses[0]
        ? {
            overall_score: analyses[0].overall_score,
            concerns: analyses[0].concerns,
            focus_regions: analyses[0].focus_regions,
            regions: analyses[0].regions,
            disclaimer: t('disclaimer'),
          }
        : null;
      const context = useContext
        ? {
            analysis,
            detection: latestDetection(),
            preferences: {
              skin_type: profile?.skin_type || null,
              diet_type: preferences.diet_type,
              allergies: preferences.allergies,
              sensitivities: preferences.sensitivities,
              current_routine: preferences.current_routine,
            },
            plans: { tips: latestTips, diet: latestDiet, routine },
          }
        : null;
      const response = await api.chat({ messages: next, language, context });
      if (!mountedRef.current) return;
      if (!response.reply?.trim()) {
        throw new ApiError(t('chatInvalid'), 'gemini_invalid_response', 502);
      }
      const reply: ChatTurn = { role: 'assistant', content: response.reply };
      setMessages([...next, reply].slice(-24));
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(chatErrorMessage(caught, t));
      setFailedText(text);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div>
      <SectionHeading
        eyebrow="AI skin assistant"
        title={t('navChat')}
        subtitle={t('chatIntro')}
        action={
          <Chip tone={statusTone}>
            {statusLabel}
          </Chip>
        }
      />

      {!apiConfig && (
        <div className="mb-5 rounded-2xl border border-peach bg-peach/30 p-4 text-sm leading-relaxed text-ink/80">
          <strong className="font-semibold">{t('error')}</strong>
          <p className="mt-1 text-xs">
            Backend unreachable. Chat is offline until the API responds.
          </p>
        </div>
      )}

      <Card className="flex h-[min(720px,calc(100vh-230px))] min-h-[480px] flex-col p-0">
        <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {messages.length === 0 && (
            <div className="mx-auto max-w-md py-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-powder text-ink">
                <MessageCircle size={24} />
              </div>
              <p className="mt-4 font-display text-lg font-semibold text-ink">{t('chatIntro')}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[
                  'Explain my skin analysis results in simple words.',
                  'Build a gentle routine for oily, acne-prone skin.',
                  'Which foods may support clearer skin?',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="rounded-full border border-line bg-white px-3 py-1.5 text-[11px] text-muted hover:border-sky hover:text-ink"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex items-start gap-2.5 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                  message.role === 'user' ? 'bg-ink text-white' : 'bg-powder text-ink'
                }`}
              >
                {message.role === 'user' ? <UserRound size={15} /> : <Sparkles size={15} />}
              </div>
              <div
                className={`min-w-0 max-w-[85%] break-words rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[78%] ${
                  message.role === 'user'
                    ? 'whitespace-pre-wrap rounded-tr-sm bg-ink text-white'
                    : 'rounded-tl-sm border border-line bg-[#fafbfe] text-ink'
                }`}
              >
                {message.role === 'user' ? message.content : <ChatMarkdown content={message.content} />}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-lavender text-plum">
                <Sparkles size={15} />
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-xs text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-plum" />
                {t('chatThinking')}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-line p-3 sm:p-4">
          {error && (
            <div
              role="alert"
              className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700"
            >
              <span>{error}</span>
              {failedText && (
                <button
                  type="button"
                  onClick={() => void send(undefined, { text: failedText, retry: true })}
                  disabled={busy || !ready}
                  className="rounded-lg border border-rose-300 px-2 py-1 font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  {t('retry')}
                </button>
              )}
            </div>
          )}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={useContext}
                onChange={(event) => setUseContext(event.target.checked)}
                className="accent-plum"
              />
              {t('chatContext')}
              {analyses.length === 0 && ` — ${t('noData')}`}
            </label>
            <span className="text-[10px] text-muted/70">
              {apiConfig
                ? geminiEnabled
                  ? 'Assistant ready'
                  : 'Assistant unavailable'
                : 'Offline'}
            </span>
          </div>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="soft"
              className="px-3 py-1.5 text-xs"
              onClick={() => (listening || requestingMic || processingVoice ? stopListening() : void startListening())}
              disabled={!ready || !recognitionSupported || busy}
              title={recognitionSupported ? undefined : t('voiceUnsupported')}
            >
              {listening || requestingMic || processingVoice ? <Square size={14} /> : <Mic size={14} />}
              {listening || requestingMic || processingVoice ? t('voiceStop') : t('voiceInput')}
            </Button>
            {requestingMic && <Chip tone="lavender">{t('voiceRequesting')}</Chip>}
            {listening && (
              <Chip tone="lavender">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-plum" />
                {t('voiceListening')}
              </Chip>
            )}
            {processingVoice && <Chip tone="lavender">{t('voiceProcessing')}</Chip>}
          </div>
          {!recognitionSupported && (
            <p className="mb-2 text-xs text-muted">{t('voiceUnsupported')}</p>
          )}
          {listening && interimText && <p className="mb-2 text-xs italic text-muted">{interimText}</p>}
          {voiceError && (
            <p
              role="alert"
              className={`mb-2 text-xs ${permissionDenied ? 'font-medium text-rose-700' : 'text-rose-600'}`}
            >
              {voiceError}
            </p>
          )}

          <form onSubmit={(event) => void send(event)} className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(event);
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder={t('typeMessage')}
              aria-label={t('typeMessage')}
              className="field min-h-[46px] flex-1 resize-none"
              disabled={!ready || busy || listening || requestingMic || processingVoice}
            />
            <Button
              type="submit"
              loading={busy}
              disabled={!ready || !input.trim() || busy || listening || requestingMic || processingVoice}
              className="h-[46px] px-4"
            >
              <Send size={16} />
              <span className="hidden sm:inline">{t('send')}</span>
            </Button>
          </form>
        </div>
      </Card>

      <div className="mt-5">
        <Disclaimer text={t('disclaimer')} />
      </div>
    </div>
  );
}
