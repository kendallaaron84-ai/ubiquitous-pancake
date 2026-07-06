"use client"

import { Button } from "@/components/ui/button"
import { CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dispatch, FormEvent, SetStateAction, useState } from "react"
import { auth } from "@/core/firebase"
import { 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider,
  AuthError 
} from "firebase/auth"
import { useRouter } from "next/navigation"

type AuthState = "signin" | "signup" | "reset" | "verify-phone" | "verify-email" | "success"

interface SignInProps {
  onStateChange: Dispatch<SetStateAction<AuthState>>
  setEmail: Dispatch<SetStateAction<string>>
}

export default function SignIn({ onStateChange, setEmail }: SignInProps) {
  const router = useRouter()
  const [emailInput, setEmailInput] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 🚀 Standard Auth Handshake Token Exchange with Next.js Backend
  const handleTokenExchange = async (idToken: string) => {
    try {
      // FORCE strict pathing to the API route, preventing 405 errors on the UI route
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idToken }),
      })

      const text = await response.text()
      let data;
      
      // Defensive parsing to catch HTML responses (like 405 Method Not Allowed)
      try {
        data = JSON.parse(text)
      } catch (jsonErr) {
        console.error("🚨 Server did not return valid JSON payload:", text)
        throw new Error(`Server returned status code: ${response.status}`)
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Backend handshake failed.")
      }

      // Successful verification! Server has assigned HTTP-Only session-token cookie
      router.push("/")
      router.refresh()
    } catch (err: any) {
      console.error("🚨 Handshake Error:", err)
      setErrorMsg(err.message || "Failed to finalize session. Please verify your product subscription.")
    }
  }

  // Email & Password Submit
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)

    try {
      // 1. Authenticate with client SDK
      const userCredential = await signInWithEmailAndPassword(auth, emailInput, password)
      const user = userCredential.user

      // 2. Fetch the ID token
      const idToken = await user.getIdToken()
      setEmail(emailInput)

      // 3. Initiate Server Handshake
      await handleTokenExchange(idToken)
    } catch (err: any) {
      console.error("🚨 Sign In Error:", err)
      const authErr = err as AuthError
      
      // User-friendly error mappings
      if (authErr.code === "auth/invalid-credential") {
        setErrorMsg("Invalid email or password combination.")
      } else if (authErr.code === "auth/user-not-found") {
        setErrorMsg("No account associated with this email address.")
      } else if (authErr.code === "auth/wrong-password") {
        setErrorMsg("Incorrect password. Please try again.")
      } else {
        setErrorMsg(authErr.message || "An unexpected sign-in error occurred.")
      }
    } finally {
      setLoading(false)
    }
  }

  // Google OAuth Federated Popup Login
  const handleGoogleSignIn = async () => {
    setLoading(true)
    setErrorMsg(null)
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: "select_account" })

    try {
      const userCredential = await signInWithPopup(auth, provider)
      const user = userCredential.user
      
      if (user.email) {
        setEmail(user.email)
      }
      
      const idToken = await user.getIdToken()
      await handleTokenExchange(idToken)
    } catch (err: any) {
      console.error("🚨 Google Sign-In Error:", err)
      const authErr = err as AuthError
      
      if (authErr.code === "auth/unauthorized-domain") {
        setErrorMsg("This domain is unauthorized for Google Sign-In. Add it to Authorized Domains in Firebase & Google Cloud Console settings.")
      } else if (authErr.code === "auth/popup-closed-by-user") {
        setErrorMsg("Sign-in window was closed before completion.")
      } else {
        setErrorMsg(authErr.message || "Failed to authenticate with Google.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col justify-center h-full bg-[#2d3b5e] rounded-xl overflow-hidden shadow-2xl border border-[#40527c]">
      <CardHeader className="space-y-1 pb-6 px-6 sm:px-10 pt-8 border-b border-[#40527c]/50">
        
        {/* Brand Logos */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <img 
            src="/KOBA-I Audio Logo Latest.png" 
            alt="KOBA-I Icon" 
            className="w-12 h-12 object-contain drop-shadow-md" 
          />
          {/* Subtle light background behind the text logo ensures the dark text pops against the navy card */}
          <div className="bg-white/90 px-3 py-1.5 rounded-md shadow-sm flex items-center justify-center">
            <img 
              src="/logo-text.png.png" 
              alt="KOBA-I Audio" 
              className="h-5 object-contain" 
            />
          </div>
        </div>

        {/* Mockup Typography */}
        <div className="space-y-1 mt-4 text-center">
          <CardTitle className="text-xl sm:text-2xl font-semibold tracking-wide text-white">
            Secure Studio Portal
          </CardTitle>
          <p className="text-sm text-slate-300 font-medium">
            Authenticate Session
          </p>
        </div>
      </CardHeader>

      <CardContent className="px-6 sm:px-10 py-6 flex-grow">
        {/* Custom React Error Alert Card */}
        {errorMsg && (
          <div className="mb-6 p-4 rounded-md bg-red-900/40 border border-red-500/50 text-red-200 text-sm leading-relaxed shadow-inner">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col h-full justify-center">
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-2">
              <Label htmlFor="email" className="text-slate-200 font-medium">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="operator@koba-i.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                disabled={loading}
                required
                className="bg-[#222b45] border-[#40527c] text-white placeholder:text-slate-500 focus-visible:ring-[#8b4528] focus-visible:border-[#8b4528] transition-all"
              />
            </div>
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-slate-200 font-medium">Security Password</Label>
                <Button 
                  type="button" 
                  variant="link" 
                  className="h-auto p-0 text-xs text-[#8b4528] hover:text-[#a65331]"
                  onClick={() => onStateChange("reset")}
                >
                  Forgot Password?
                </Button>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
                className="bg-[#222b45] border-[#40527c] text-white placeholder:text-slate-500 focus-visible:ring-[#8b4528] focus-visible:border-[#8b4528] transition-all"
              />
            </div>
          </div>
          
          <Button 
            className="w-full mt-8 bg-[#8b4528] hover:bg-[#723820] text-white font-semibold py-6 shadow-lg hover:shadow-xl transition-all" 
            type="submit" 
            disabled={loading}
          >
            {loading ? "Authenticating..." : "Sign In"}
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[#40527c]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase font-semibold">
              <span className="bg-[#2d3b5e] px-3 text-slate-400">Or continue with</span>
            </div>
          </div>

          <Button 
            type="button" 
            variant="outline" 
            className="w-full bg-[#222b45] border-[#40527c] text-white hover:bg-[#1a2138] hover:text-white py-6 transition-all" 
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg className="mr-3 h-5 w-5" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
              <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 152.6 240 148 224 148c-66.8 0-121.4 54.3-121.4 121.4s54.6 121.4 121.4 121.4c76.2 0 111.7-54.7 116.2-83h-116.2v-85.3h203.2c2.1 11 3 22.6 3 34.7z"></path>
            </svg>
            Sign In with Google
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row justify-center gap-2 px-6 py-6 bg-[#222b45]/50 border-t border-[#40527c]/50 mt-auto">
        <div className="text-sm text-slate-300">
          Don&apos;t have an account?{" "}
          <Button variant="link" className="h-auto p-0 font-bold text-[#8b4528] hover:text-[#a65331]" onClick={() => onStateChange("signup")}>
            Sign Up
          </Button>
        </div>
      </CardFooter>
    </div>
  )
}
```