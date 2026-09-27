import type {
  AuthResponse,
  CreateExamInput,
  DocumentDetail,
  DocumentProgress,
  DocumentSummary,
  Exam,
  LoginInput,
  RegisterInput,
  SubmitExamInput,
  BillingCatalog,
  Entitlement,
  MockState,
  PlanId,
  TrackEventsInput,
  User,
  CreateStudyPlanInput,
  StudyPlan,
  UpdateStudyPlanInput,
  CourseMaterial,
  CourseMaterialDetail,
} from '@study/shared';
import { MATERIAL_HEADERS } from '@study/shared';
import type { AiLanguage } from '@study/shared';
import { File as FsFile, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { apiUrlResult } from '@/config/app-config';
import i18n from '@/i18n';
import { log } from './log';

/**
 * API base URL — see src/config/api-url.js. Release builds only ever use the configured HTTPS URL;
 * if it is missing/invalid, API_URL is null and the app shows a configuration error screen.
 */
export const API_URL: string | null = apiUrlResult.ok ? apiUrlResult.url : null;
export const API_CONFIG_ERROR: string | null = apiUrlResult.ok ? null : apiUrlResult.error;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable error code from the API (e.g. "limit_reached", "ai_unavailable"). */
    public code?: string,
    /** Full JSON error body (e.g. LimitErrorBody for 402s). */
    public body?: unknown,
  ) {
    super(message);
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setAuthToken = (t: string | null) => (authToken = t);
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new ApiError(0, API_CONFIG_ERROR ?? 'API not configured', 'app_misconfigured');
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  headers['Accept-Language'] = i18n.language || 'en';
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const method = init.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (err) {
    // fetch rejects both for real network failures and for requests it can't build/send
    // (e.g. an unsupported body). Log the real cause and only blame the network when it is one.
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    log.error(`[api] ${method} ${path} failed before a response:`, err);
    const isNetwork = /network request failed|fetch failed|timed? ?out|offline|could not connect|connection/i.test(detail);
    throw new ApiError(0, detail, isNetwork ? 'network' : 'request_failed');
  }
  if (res.status === 401 && authToken) onUnauthorized?.();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data);
  return data as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export type PickedFile = { uri: string; name: string; mimeType?: string; file?: File };

function headersFor(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Accept-Language': i18n.language || 'en', ...extra };
}

/**
 * Sends a course material (PDF, lecture audio or video) as the raw request body.
 * Native: expo-file-system's upload task streams the file from disk (a 1 GB video is never loaded
 * into memory — expo/fetch would buffer the whole body) and reports progress; on iOS it keeps going
 * if the app is briefly backgrounded. Web: the browser streams the picked File.
 */
async function uploadMaterialFile(documentId: string, file: PickedFile, language: AiLanguage, onProgress?: (fraction: number) => void): Promise<CourseMaterial> {
  if (!API_URL) throw new ApiError(0, API_CONFIG_ERROR ?? 'API not configured', 'app_misconfigured');
  const url = `${API_URL}/documents/${documentId}/materials`;
  const headers = headersFor({
    'Content-Type': file.mimeType || 'application/octet-stream',
    [MATERIAL_HEADERS.title]: encodeURIComponent(file.name),
    [MATERIAL_HEADERS.language]: language,
  });
  let status: number;
  let text: string;
  try {
    if (Platform.OS === 'web' && file.file) {
      const res = await fetch(url, { method: 'POST', headers, body: file.file });
      status = res.status;
      text = await res.text();
      onProgress?.(1);
    } else {
      const res = await new FsFile(file.uri).upload(url, {
        httpMethod: 'POST',
        uploadType: UploadType.BINARY_CONTENT,
        headers,
        mimeType: file.mimeType,
        onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && onProgress?.(bytesSent / totalBytes),
      });
      status = res.status;
      text = res.body;
    }
  } catch (err) {
    log.error('[api] material upload failed before a response:', err);
    throw new ApiError(0, err instanceof Error ? err.message : String(err), 'network');
  }
  if (status === 401 && authToken) onUnauthorized?.();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (status < 200 || status >= 300) {
    const body = data as { error?: string; code?: string } | null;
    throw new ApiError(status, body?.error ?? `Upload failed (${status})`, body?.code, data);
  }
  return data as CourseMaterial;
}

export const api = {
  register: (input: RegisterInput) => post<AuthResponse>('/auth/register', input),
  login: (input: LoginInput) => post<AuthResponse>('/auth/login', input),
  me: () => request<User>('/auth/me'),
  /** Permanently deletes the account (server verifies the password). */
  deleteAccount: (password: string) =>
    request<{ hadActiveSubscription: boolean }>('/auth/me', { method: 'DELETE', body: JSON.stringify({ password }) }),

  listDocuments: () => request<DocumentSummary[]>('/documents'),
  getDocument: (id: string) => request<DocumentDetail>(`/documents/${id}`),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  reprocessDocument: (id: string) => post<DocumentDetail>(`/documents/${id}/reprocess`),
  getProgress: (id: string) => request<DocumentProgress>(`/documents/${id}/progress`),
  uploadDocument: (file: PickedFile, language: AiLanguage) => {
    const form = new FormData();
    if (Platform.OS === 'web' && file.file) {
      form.append('file', file.file);
    } else {
      // Expo SDK 57 replaces the global fetch with expo/fetch, which does NOT support React Native's
      // legacy `{ uri, name, type }` FormData parts (it throws before sending). expo-file-system's
      // File implements Blob, which expo/fetch streams into the multipart body.
      form.append('file', new FsFile(file.uri) as unknown as Blob);
    }
    // The picked file lives in the cache under a generated name, so send the original name separately.
    form.append('title', file.name);
    // Study language for the summary and topics (en/es/fr/ar, or "source" = the PDF's own language).
    form.append('language', language);
    return request<DocumentDetail>('/documents', { method: 'POST', body: form });
  },

  // Billing — the server decides access; the app only displays it.
  // The server answers which store sells on this platform (App Store on iOS, Google Play on Android, none on web).
  getCatalog: () => request<BillingCatalog>(`/billing/plans?platform=${Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web'}`),
  getEntitlement: () => request<Entitlement>('/billing/status'),
  purchase: (planId: PlanId, startTrial: boolean) => post<Entitlement>('/billing/purchase', { planId, startTrial }),
  restorePurchases: () => post<Entitlement>('/billing/restore', {}),
  /** App Store: hand a StoreKit 2 signed transaction (JWS) to the server for verification. */
  applePurchase: (signedTransaction: string) => post<Entitlement>('/billing/purchase', { store: 'apple', signedTransaction }),
  appleRestore: (signedTransactions: string[]) => post<Entitlement>('/billing/restore', { store: 'apple', signedTransactions }),
  googlePurchase: (purchaseToken: string, productId: string) => post<Entitlement>('/billing/purchase', { store: 'google', purchaseToken, productId }),
  googleRestore: (purchases: { purchaseToken: string; productId: string }[]) => post<Entitlement>('/billing/restore', { store: 'google', purchases }),
  cancelSubscription: () => post<Entitlement>('/billing/cancel', {}),
  setMockBillingState: (state: MockState) => post<Entitlement>('/billing/mock/state', { state }),

  sendEvents: (input: TrackEventsInput) => post<{ accepted: number }>('/events', input),

  createExam: (documentId: string, input: CreateExamInput) => post<Exam>(`/documents/${documentId}/exams`, input),

  // Study planner (one plan per course). Only create/rebuild use AI; everything else is free.
  /** null when the course has no plan yet. */
  getStudyPlan: async (documentId: string): Promise<StudyPlan | null> => {
    try {
      return await request<StudyPlan>(`/documents/${documentId}/study-plan`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_study_plan') return null;
      throw err;
    }
  },
  createStudyPlan: (documentId: string, input: CreateStudyPlanInput) => post<StudyPlan>(`/documents/${documentId}/study-plan`, input),
  updateStudyPlan: (documentId: string, input: UpdateStudyPlanInput) =>
    request<StudyPlan>(`/documents/${documentId}/study-plan`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteStudyPlan: (documentId: string) => request<void>(`/documents/${documentId}/study-plan`, { method: 'DELETE' }),
  regenerateStudyPlan: (documentId: string, language?: AiLanguage) => post<StudyPlan>(`/documents/${documentId}/study-plan/regenerate`, { language }),
  completeStudyTask: (documentId: string, taskId: string) => post<StudyPlan>(`/documents/${documentId}/study-plan/tasks/${taskId}/complete`, {}),
  skipStudyTask: (documentId: string, taskId: string) => post<StudyPlan>(`/documents/${documentId}/study-plan/tasks/${taskId}/skip`, {}),
  recalculateStudyPlan: (documentId: string) => post<StudyPlan>(`/documents/${documentId}/study-plan/recalculate`, {}),

  // Course materials (lecture audio/video, extra PDFs). Processing happens on the server; poll getMaterial.
  listMaterials: (documentId: string) => request<CourseMaterial[]>(`/documents/${documentId}/materials`),
  getMaterial: (documentId: string, materialId: string) => request<CourseMaterialDetail>(`/documents/${documentId}/materials/${materialId}`),
  uploadMaterial: uploadMaterialFile,
  retryMaterial: (documentId: string, materialId: string) => post<CourseMaterial>(`/documents/${documentId}/materials/${materialId}/retry`, {}),
  deleteMaterial: (documentId: string, materialId: string) => request<void>(`/documents/${documentId}/materials/${materialId}`, { method: 'DELETE' }),
  getExam: (id: string) => request<Exam>(`/exams/${id}`),
  submitExam: (id: string, input: SubmitExamInput) => post<Exam>(`/exams/${id}/submit`, input),
};
