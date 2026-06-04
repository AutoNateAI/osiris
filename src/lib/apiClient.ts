'use client';

import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

const DEFAULT_FIREBASE_API_BASE_URL = 'https://intelapi-4qinfaeidq-uc.a.run.app';
const apiBaseUrl = (process.env.NEXT_PUBLIC_FIREBASE_API_BASE_URL || DEFAULT_FIREBASE_API_BASE_URL).replace(/\/$/, '');

let authReadyPromise: Promise<void> | null = null;

function waitForAuthReady() {
  if (auth.currentUser) return Promise.resolve();
  authReadyPromise ||= new Promise((resolve) => {
    let unsubscribe = () => {};
    const timeout = window.setTimeout(() => {
      unsubscribe();
      resolve();
    }, 2500);
    unsubscribe = onAuthStateChanged(auth, () => {
      window.clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
  return authReadyPromise;
}

export function apiUrl(path: string): string {
  if (!apiBaseUrl || /^https?:\/\//i.test(path)) return path;
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function authenticatedFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (apiBaseUrl) await waitForAuthReady();

  if (apiBaseUrl && auth.currentUser) {
    headers.set('Authorization', `Bearer ${await auth.currentUser.getIdToken()}`);
  }

  return fetch(apiUrl(path), {
    ...init,
    headers,
  });
}
