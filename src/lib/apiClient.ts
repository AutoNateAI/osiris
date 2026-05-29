'use client';

import { auth } from '@/lib/firebase';

const apiBaseUrl = process.env.NEXT_PUBLIC_FIREBASE_API_BASE_URL?.replace(/\/$/, '') || '';

export function apiUrl(path: string): string {
  if (!apiBaseUrl || /^https?:\/\//i.test(path)) return path;
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function authenticatedFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const user = auth.currentUser;

  if (apiBaseUrl && user) {
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  }

  return fetch(apiUrl(path), {
    ...init,
    headers,
  });
}
