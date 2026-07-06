'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth } from '@/core/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { Lock, Mail, Key, Check, Eye, EyeOff, ShieldAlert, Sparkles, Volume2 } from 'lucide-react';

function SetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Safely extract email and license param variables
  const emailParam = searchParams.get('email') || '';
  const licenseParam = searchParams.get('license') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);

  // Criteria validation checks
  const criteria = {
    length: password.length >= 8,
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    match: password !== '' && password === confirmPassword
  };

  const isFormValid = Object.values(criteria).every(Boolean) && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    setLoading(true);
    setErrorMsg('');

    try {
      // 1. Post parameters directly to activation controller
      const res = await fetch('/api/auth/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: emailParam,
          license: licenseParam,
          password: password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Activation handshake failed.');
      }

      setSuccess(true);
      
      // 2. Hydrate client side auth using Custom Token
      await signInWithCustomToken(auth, data.customToken);

      // 3. Set standard security token in cookies for Next.js Middleware authentication
      document.cookie = `session-token=${data.customToken}; path=/; max-age=86400; SameSite=Strict; Secure`;

      // 4. Redirect smoothly to active admin layout
      setTimeout(() => {
        router.push('/');
      }, 1500);

    } catch (err: any) {
      console.error('Onboarding Exception:', err);
      setErrorMsg(err.message || 'System failed to register account.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg p-8 space-y-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl relative overflow-hidden">
      {/* Glow highlight */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Branded Header: KOBA-I Audio */}
      <div className="text-center space-y-2 relative z-10">
        <div className="inline-flex p-3 rounded-full bg-purple-500/10 text-purple-400 mb-2 border border-purple-500/20">
          <Volume2 className="w-7 h-7 text-purple-500 animate-pulse" />
        </div>
        <div className="flex items-center justify-center space-x-1.5">
          <span className="text-2xl font-black tracking-tight text-white uppercase">KOBA-I</span>
          <span className="text-2xl font-light tracking-wide text-purple-400 uppercase">AUDIO</span>
        </div>
        <p className="text-xs font-semibold uppercase tracking-widest text-purple-500/80">Author Command Center</p>
        <p className="text-sm text-slate-400 mt-2">
          Claim your multi-tenant workspace. Establish your password below to configure your premium audiobook suite.
        </p>
      </div>

      {(!emailParam || !licenseParam) ? (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start space-x-3 text-amber-400">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <span className="font-semibold block">Incomplete Invitation Link</span>
            <span>Ensure you click the exact URL sent to your registered checkout email containing your workspace authorization parameters.</span>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">Onboarding Profile</label>
              <div className="flex items-center space-x-2.5 p-3.5 bg-slate-950 border border-slate-800/80 rounded-xl text-slate-300 select-none">
                <Mail className="w-4.5 h-4.5 text-slate-500" />
                <span className="text-sm truncate">{emailParam}</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">Master License Code</label>
              <div className="flex items-center space-x-2.5 p-3.5 bg-slate-950 border border-slate-800/80 rounded-xl text-slate-300 font-mono text-xs tracking-wider select-none">
                <Key className="w-4.5 h-4.5 text-slate-500" />
                <span>{licenseParam}</span>
              </div>
            </div>
          </div>

          <hr className="border-slate-800/80" />

          {/* Secure Credential Input */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 block mb-1">Create Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full pl-10 pr-10 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500 transition-colors"
                  disabled={loading || success}
                />
                <Lock className="w-4.5 h-4.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:text-slate-300 text-slate-500 transition-colors focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 block mb-1">Confirm Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm security credentials"
                  className="w-full pl-10 pr-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500 transition-colors"
                  disabled={loading || success}
                />
                <Lock className="w-4.5 h-4.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>
          </div>

          {/* Validation indicators */}
          <div className="grid grid-cols-2 gap-2.5 p-4 bg-slate-950/50 border border-slate-800/80 rounded-xl">
            <div className="flex items-center space-x-2 text-xs">
              <span className={`p-0.5 rounded-full ${criteria.length ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                <Check className="w-3.5 h-3.5" />
              </span>
              <span className={criteria.length ? 'text-slate-300' : 'text-slate-500'}>8+ Characters</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <span className={`p-0.5 rounded-full ${criteria.number ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                <Check className="w-3.5 h-3.5" />
              </span>
              <span className={criteria.number ? 'text-slate-300' : 'text-slate-500'}>Contains a number</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <span className={`p-0.5 rounded-full ${criteria.special ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                <Check className="w-3.5 h-3.5" />
              </span>
              <span className={criteria.special ? 'text-slate-300' : 'text-slate-500'}>Special Symbol</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <span className={`p-0.5 rounded-full ${criteria.match ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                <Check className="w-3.5 h-3.5" />
              </span>
              <span className={criteria.match ? 'text-slate-300' : 'text-slate-500'}>Passwords match</span>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!isFormValid || success}
            className={`w-full py-4 text-sm font-semibold tracking-wide rounded-xl transition-all duration-300 flex items-center justify-center ${
              success
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : isFormValid
                ? 'bg-purple-600 hover:bg-purple-500 text-slate-50 hover:shadow-lg shadow-purple-500/10'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {success ? (
              <span className="flex items-center space-x-2">
                <span>Access Granted! Opening workspace...</span>
              </span>
            ) : loading ? (
              <span className="w-5 h-5 border-2 border-slate-50 border-t-transparent rounded-full animate-spin" />
            ) : (
              'Confirm Credentials & Open Command Center'
            )}
          </button>
        </form>
      )}
    </div>
  );
}

export default function SetupPasswordPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <Suspense fallback={
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-400">Loading secure environment...</p>
        </div>
      }>
        <SetupForm />
      </Suspense>
    </div>
  );
}