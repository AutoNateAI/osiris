'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { LogOut } from 'lucide-react';
import { auth } from '@/lib/firebase';
import MarketingSite from '@/components/MarketingSite';

interface AuthGateProps {
  children: ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [path, setPath] = useState('/');

  useEffect(() => {
    setPath(window.location.pathname);
    return onAuthStateChanged(auth, currentUser => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && user && path !== '/') {
      window.location.replace('/');
    }
  }, [loading, path, user]);

  const signInWithGoogle = async () => {
    setError('');
    setNotice('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email authentication failed.');
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email first, then request a reset link.');
      return;
    }
    setError('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('Password reset email sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    }
  };

  if (loading) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-[var(--bg-void)] text-[var(--text-primary)]">
        <div className="glass-panel px-5 py-4 font-mono text-[10px] tracking-[0.2em] text-[var(--gold-primary)]">
          VERIFYING ACCESS...
        </div>
      </main>
    );
  }

  if (user && path !== '/') {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-[var(--bg-void)] text-[var(--text-primary)]">
        <div className="glass-panel px-5 py-4 font-mono text-[10px] tracking-[0.2em] text-[var(--gold-primary)]">
          ROUTING TO PORTAL...
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <MarketingSite
        email={email}
        password={password}
        mode={mode}
        error={error}
        notice={notice}
        setEmail={setEmail}
        setPassword={setPassword}
        setMode={setMode}
        signInWithGoogle={signInWithGoogle}
        submitEmail={submitEmail}
        resetPassword={resetPassword}
      />
    );
  }

  return (
    <>
      {children}
      <div className="fixed top-3 right-3 z-[500] pointer-events-auto">
        <div className="glass-panel px-2.5 py-1.5 flex items-center gap-2">
          <span className="hidden md:inline max-w-[180px] truncate font-mono text-[9px] text-[var(--text-secondary)]">
            {user.displayName || user.email}
          </span>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--alert-red)] transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}
