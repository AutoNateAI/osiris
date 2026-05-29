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
import { LogOut, Mail, Shield, UserCircle } from 'lucide-react';
import { auth } from '@/lib/firebase';

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

  useEffect(() => {
    return onAuthStateChanged(auth, currentUser => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

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

  if (!user) {
    return (
      <main className="fixed inset-0 bg-[var(--bg-void)] text-[var(--text-primary)] overflow-hidden">
        <div className="absolute inset-0 opacity-[0.08]" style={{
          backgroundImage: 'linear-gradient(var(--gold-primary) 1px, transparent 1px), linear-gradient(90deg, var(--gold-primary) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }} />
        <div className="relative z-10 h-full flex items-center justify-center p-4">
          <section className="glass-panel osiris-glow w-full max-w-[420px] p-5 md:p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full border border-[var(--gold-primary)] flex items-center justify-center bg-[var(--hover-accent)]">
                <Shield className="w-5 h-5 text-[var(--gold-primary)]" />
              </div>
              <div>
                <h1 className="font-mono text-lg font-bold tracking-[0.18em] text-[var(--text-heading)]">AUTONATEAI</h1>
                <p className="font-mono text-[9px] tracking-[0.22em] text-[var(--gold-primary)]">INTEL ACCESS</p>
              </div>
            </div>

            <button
              type="button"
              onClick={signInWithGoogle}
              className="w-full h-10 flex items-center justify-center gap-2 border border-[var(--border-active)] bg-[var(--hover-accent)] text-[var(--text-primary)] hover:border-[var(--gold-primary)] transition-colors font-mono text-[10px] tracking-[0.14em]"
            >
              <UserCircle className="w-4 h-4" />
              CONTINUE WITH GOOGLE
            </button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border-secondary)]" />
              <span className="font-mono text-[8px] text-[var(--text-muted)] tracking-[0.2em]">OR</span>
              <div className="h-px flex-1 bg-[var(--border-secondary)]" />
            </div>

            <form onSubmit={submitEmail} className="space-y-3">
              <label className="block">
                <span className="hud-label">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  className="mt-1 w-full h-10 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
                />
              </label>
              <label className="block">
                <span className="hud-label">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  className="mt-1 w-full h-10 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
                />
              </label>
              <button
                type="submit"
                className="w-full h-10 flex items-center justify-center gap-2 bg-[var(--gold-primary)] text-black font-mono text-[10px] font-bold tracking-[0.14em] hover:bg-[var(--gold-light)] transition-colors"
              >
                <Mail className="w-4 h-4" />
                {mode === 'signin' ? 'SIGN IN' : 'CREATE ACCESS'}
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between gap-3 font-mono text-[9px]">
              <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="text-[var(--cyan-primary)] hover:text-[var(--text-primary)]">
                {mode === 'signin' ? 'CREATE ACCOUNT' : 'USE EXISTING ACCOUNT'}
              </button>
              <button type="button" onClick={resetPassword} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                RESET PASSWORD
              </button>
            </div>

            {error && <p className="mt-4 text-[10px] text-[var(--alert-red)] font-mono leading-relaxed">{error}</p>}
            {notice && <p className="mt-4 text-[10px] text-[var(--alert-green)] font-mono leading-relaxed">{notice}</p>}
          </section>
        </div>
      </main>
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
