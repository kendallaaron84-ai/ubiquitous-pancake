// Filepath: app/signin/page.tsx
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/core/firebase';
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { Mail, Lock, ShieldAlert, Volume2, ArrowRight } from 'lucide-react';

export default function SignInPage() {
  const router = useRouter();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 1. Process standard Email/Password Login
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setLoading(true);
    setErrorMsg('');

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await exchangeToken(userCredential.user);
    } catch (err: any) {
      console.error('Email Login Error:', err);
      setErrorMsg(err.message || 'Invalid email or password.');
      setLoading(false);
    }
  };

  // 2. Process Google Sign-In
  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setErrorMsg('');
    const provider = new GoogleAuthProvider();

    try {
      const userCredential = await signInWithPopup(auth, provider);
      await exchangeToken(userCredential.user);
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);
      // Ignore user cancellation errors
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setErrorMsg('Google authentication failed. Please try again.');
      }
      setGoogleLoading(false);
    }
  };

  // 3. Secure Token Exchange (Handshake with Next.js Backend)
  const exchangeToken = async (user: any) => {
    try {
      // Get the fresh identity token from the client SDK
      const idToken = await user.getIdToken(true);

      // Post it to our dynamic Next.js serverless route
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        // If the backend blocks it (e.g. no active license), sign them out of the client immediately
        await auth.signOut();
        throw new Error(data.error || 'Server rejected identity exchange.');
      }

      // Success: Next.js has set the secure HttpOnly cookie. Redirect to dashboard.
      router.push('/');
    } catch (err: any) {
      console.error('Exchange Handshake Error:', err);
      setErrorMsg(err.message || 'Failed to authenticate session with the server.');
      setLoading(false);
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl relative overflow-hidden">
        
        {/* Decorative Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* KOBA-I Audio Header */}
        <div className="text-center space-y-2 relative z-10">
          <div className="inline-flex p-3 rounded-full bg-purple-500/10 text-purple-400 mb-2 border border-purple-500/20">
            <Volume2 className="w-7 h-7 text-purple-500" />
          </div>
          <div className="flex items-center justify-center space-x-1.5">
            <span className="text-2xl font-black tracking-tight text-white uppercase">KOBA-I</span>
            <span className="text-2xl font-light tracking-wide text-purple-400 uppercase">AUDIO</span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-purple-500/80">Command Center Login</p>
        </div>

        {errorMsg && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center space-x-2 relative z-10">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-4 relative z-10">
          {/* Google Sign-In Button */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading || googleLoading}
            className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-slate-900 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center space-x-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <span className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          <div className="flex items-center space-x-3 text-slate-500 text-xs py-2">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="uppercase tracking-wider font-semibold">Or use email</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>

          {/* Email / Password Form */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Author Email Address"
                  className="w-full pl-10 pr-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500 transition-colors"
                  disabled={loading || googleLoading}
                  required
                />
                <Mail className="w-4.5 h-4.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full pl-10 pr-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500 transition-colors"
                  disabled={loading || googleLoading}
                  required
                />
                <Lock className="w-4.5 h-4.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading || !email || !password}
              className="w-full py-3.5 text-sm font-semibold tracking-wide rounded-xl transition-all duration-300 flex items-center justify-center bg-purple-600 hover:bg-purple-500 text-slate-50 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-slate-50 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="flex items-center space-x-2">
                  <span>Sign In Securely</span>
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>
          </form>
        </div>

        {/* Claim Account Link for New Stripe Purchases */}
        <div className="pt-4 text-center relative z-10 border-t border-slate-800">
          <p className="text-xs text-slate-400">
            Just purchased a license?{' '}
            <button 
              onClick={() => router.push('/setup-password')} 
              className="text-purple-400 hover:text-purple-300 font-semibold underline-offset-4 hover:underline transition-all"
            >
              Claim your account setup here.
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}