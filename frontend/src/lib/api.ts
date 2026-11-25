import type {
  AnalysisResult,
  ApiConfig,
  ApiErrorShape,
  ChatTurn,
  DetectionResult,
  DetectionStatus,
  DietPlan,
  DietType,
  EnhancementResult,
  Language,
  ProductCatalog,
  ProduceCatalog,
  SkinConditionResult,
  SkinConditionStatus,
  TipPlan,
  VisibleAnalysis,
} from '../types';

const BASE_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '');

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = 'unknown', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorShape = {};
  try {
    body = (await response.json()) as ApiErrorShape;
  } catch {
    // non-JSON error response
  }
  const message =
    body.error?.message ||
    (typeof body.detail === 'string' ? body.detail : body.detail?.msg) ||
    `Request failed (${response.status})`;
  return new ApiError(message, body.error?.code || 'request_failed', response.status);
}

let currentUserId = 'local-user';
export function setApiUserId(userId: string | null | undefined) {
  currentUserId = userId?.trim() || 'local-user';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        'X-User-Id': currentUserId,
        ...init?.headers,
      },
    });
  } catch {
    if (init?.signal?.aborted) {
      throw new ApiError('The request took too long. Please try again.', 'timeout', 408);
    }
    throw new ApiError(
      `Cannot reach the AcneLyze API at ${BASE_URL}. Start the backend or check VITE_API_URL.`,
      'network_error',
    );
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

function imageForm(file: File, extra?: Record<string, string>): FormData {
  const form = new FormData();
  form.append('file', file);
  Object.entries(extra || {}).forEach(([key, value]) => form.append(key, value));
  return form;
}

export const api = {
  baseUrl: BASE_URL,

  health: () => request<{ status: string; version: string }>('/api/health'),

  config: (signal?: AbortSignal) =>
    request<ApiConfig>('/api/config', { signal }),

  validateUpload: (file: File) =>
    request<{ valid: boolean; width: number; height: number; note: string }>(
      '/api/uploads/validate',
      { method: 'POST', body: imageForm(file) },
    ),

  analyze: (file: File, signal?: AbortSignal) =>
    request<AnalysisResult>('/api/analyze', {
      method: 'POST',
      body: imageForm(file),
      signal,
    }),

  enhance: (file: File, strength: number, signal?: AbortSignal) =>
    request<EnhancementResult>('/api/enhance', {
      method: 'POST',
      body: imageForm(file, { strength: String(strength) }),
      signal,
    }),

  enhancePng: async (file: File, strength: number, signal?: AbortSignal) => {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/api/enhance/png`, {
        method: 'POST',
        body: imageForm(file, { strength: String(strength) }),
        signal,
      });
    } catch {
      throw new ApiError(
        `Cannot reach the AcneLyze API at ${BASE_URL}. Start the backend or check VITE_API_URL.`,
        'network_error',
      );
    }
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },

  tips: (input: {
    analysis: VisibleAnalysis | null;
    preferences: {
      skin_type: string;
      goals: string[];
      sensitivities: string[];
      current_routine: string;
    };
    language: Language;
  }) =>
    request<TipPlan>('/api/tips', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  diet: (input: {
    analysis: VisibleAnalysis | null;
    preferences: {
      diet_type: DietType;
      allergies: string[];
      dislikes: string[];
      weight_kg: number | null;
      meals_per_day: number;
    };
    language: Language;
  }) =>
    request<DietPlan>('/api/diet', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  recommendations: (input: {
    analysis: VisibleAnalysis | null;
    detection: Record<string, unknown> | null;
    condition?: Record<string, unknown> | null;
    preferences: {
      skin_type: string;
      goals: string[];
      sensitivities: string[];
      current_routine: string;
      diet_type: DietType;
      allergies: string[];
      dislikes: string[];
      weight_kg: number | null;
      meals_per_day: number;
    };
    language: Language;
  }) =>
    request<import('../types').RecommendationResponse>('/api/recommendations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  chat: (
    input: {
      messages: ChatTurn[];
      language: Language;
      context: Record<string, unknown> | null;
    },
    timeoutMs = 90000,
  ) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    return request<{ reply: string; generator: string; model: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(input),
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timer));
  },

  detectStatus: () => request<DetectionStatus>('/api/detect/status'),

  detect: (file: File, confidence?: number, iou?: number, signal?: AbortSignal) =>
    request<DetectionResult>('/api/detect', {
      method: 'POST',
      body: imageForm(file, {
        ...(confidence !== undefined ? { confidence: String(confidence) } : {}),
        ...(iou !== undefined ? { iou: String(iou) } : {}),
      }),
      signal,
    }),

  skinConditionStatus: () => request<SkinConditionStatus>('/api/skin-condition/status'),

  skinConditionPredict: (file: File, threshold?: number, signal?: AbortSignal) =>
    request<SkinConditionResult>('/api/skin-condition/predict', {
      method: 'POST',
      body: imageForm(file, {
        ...(threshold !== undefined ? { threshold: String(threshold) } : {}),
      }),
      signal,
    }),

  skinDiseaseAnalysis: (
    file: File,
    options?: { confidence?: number; iou?: number; threshold?: number },
    signal?: AbortSignal,
  ) =>
    request<import('../types').SkinDiseaseAnalysisResult>('/api/skin-analysis', {
      method: 'POST',
      body: imageForm(file, {
        ...(options?.confidence !== undefined ? { confidence: String(options.confidence) } : {}),
        ...(options?.iou !== undefined ? { iou: String(options.iou) } : {}),
        ...(options?.threshold !== undefined ? { threshold: String(options.threshold) } : {}),
      }),
      signal,
    }),

  // Backward-compatible wrappers
  skinConditionAnalyse: (file: File, threshold?: number, signal?: AbortSignal) =>
    api.skinConditionPredict(file, threshold, signal),



  products: (params: {
    skin_type?: string;
    concerns?: string[];
    sensitivities?: string[];
    allergies?: string[];
    existing_routine?: string;
    category?: string;
    budget?: string;
    analysis?: VisibleAnalysis;
  }) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (key === 'sensitivities' || key === 'analysis') return;
      if (Array.isArray(value) && value.length) query.set(key, value.join(','));
      else if (typeof value === 'string' && value) query.set(key, value);
    });
    if (params.sensitivities?.length) query.set('sensitivities', params.sensitivities.join(','));
    if (params.analysis) query.set('analysis', JSON.stringify(params.analysis));
    const suffix = query.toString();
    return request<ProductCatalog>(`/api/catalog/products${suffix ? `?${suffix}` : ''}`);
  },

  fruits: (tag?: string, search?: string) => {
    const query = new URLSearchParams();
    if (tag) query.set('tag', tag);
    if (search) query.set('search', search);
    const suffix = query.toString();
    return request<ProduceCatalog>(`/api/catalog/fruits${suffix ? `?${suffix}` : ''}`);
  },

  vegetables: (tag?: string, search?: string) => {
    const query = new URLSearchParams();
    if (tag) query.set('tag', tag);
    if (search) query.set('search', search);
    const suffix = query.toString();
    return request<ProduceCatalog>(`/api/catalog/vegetables${suffix ? `?${suffix}` : ''}`);
  },

  reportPdf: async (payload: Record<string, unknown>) => {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/api/report/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUserId },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new ApiError(
        `Cannot reach the AcneLyze API at ${BASE_URL}. Start the backend or check VITE_API_URL.`,
        'network_error',
      );
    }
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },

  reminders: {
    list: () => request<{ items: import('../types').Reminder[] }>('/api/reminders'),
    create: (payload: Partial<import('../types').Reminder>) => request<import('../types').Reminder>('/api/reminders', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: string, payload: Partial<import('../types').Reminder>) => request<import('../types').Reminder>(`/api/reminders/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
    toggle: (id: string, enabled: boolean) => request<import('../types').Reminder>(`/api/reminders/${encodeURIComponent(id)}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    markNotified: (id: string, notified_at?: string) => request<import('../types').Reminder>(`/api/reminders/${encodeURIComponent(id)}/notified`, { method: 'POST', body: JSON.stringify({ notified_at }) }),
    remove: (id: string) => request<{ deleted: boolean }>(`/api/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    notifications: (limit = 30) => request<{ items: import('../types').ReminderNotificationLog[] }>(`/api/reminders/notifications?limit=${limit}`),
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
