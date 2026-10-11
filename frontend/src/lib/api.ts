export type Category = 'behavioral' | 'coding' | 'system-design' | 'english' | 'other';
export type Segment = { id: number; start: number; end: number; text: string };
export type Recording = {
  id: string;
  title: string;
  category: Category;
  language: string;
  tags: string[];
  notes: string;
  duration_seconds: number;
  size_bytes: number;
  mime_type: string;
  created_at: string;
  audio_url: string;
  transcription_status: 'pending'|'processing'|'completed'|'failed';
  transcription_error?: string|null;
  segments?: Segment[];
};
export type Stats = { total_sessions: number; total_seconds: number; by_category: Array<{category: Category; count: number; seconds: number}> };
export const LABELS: Record<Category,string> = {
  behavioral: 'Behavioral', coding: 'Coding', 'system-design': 'System Design', english: 'English Practice', other: 'Other'
};
export const CATEGORY_EMOJI: Record<Category,string> = {behavioral: '✦', coding: '</>', 'system-design': '◈', english: 'Aa', other: '◇'};

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, { ...options, cache: 'no-store' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { const details = await response.json(); message = details.detail || message; } catch { /* use status */ }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export function clock(seconds: number):string {
  const s = Math.floor(seconds);
  return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
}
export function dateText(value: string) { return new Date(value).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); }
