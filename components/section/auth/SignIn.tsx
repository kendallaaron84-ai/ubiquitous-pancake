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
  const [showRecoveryActions, setShowRecoveryActions] = useState<boolean>(false)

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
      } catch {
        console.error("🚨 Server did not return valid JSON payload:", text)
        throw new Error(`Server returned status code: ${response.status}`)
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Backend handshake failed.")
      }

      // Successful verification! Server has assigned HTTP-Only session-token cookie
      router.push("/products")
      router.refresh()
    } catch (err: unknown) {
      console.error("🚨 Handshake Error:", err)
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Failed to finalize session. Please verify your product subscription."
      )
    }
  }

  // Email & Password Submit
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)
    setShowRecoveryActions(false)

    try {
      // 1. Authenticate with client SDK
      const userCredential = await signInWithEmailAndPassword(auth, emailInput, password)
      const user = userCredential.user

      // 2. Fetch the ID token
      const idToken = await user.getIdToken()
      setEmail(emailInput)

      // 3. Initiate Server Handshake
      await handleTokenExchange(idToken)
    } catch (err: unknown) {
      const authErr = err as AuthError
      
      // User-friendly error mappings
      if (
        authErr.code === "auth/invalid-credential" ||
        authErr.code === "auth/user-not-found" ||
        authErr.code === "auth/wrong-password"
      ) {
        setErrorMsg("Incorrect email or password. Try again or reset your password.")
        setShowRecoveryActions(true)
      } else if (authErr.code === "auth/too-many-requests") {
        setErrorMsg("Sign-in is temporarily locked after several attempts. Reset your password or try again later.")
        setShowRecoveryActions(true)
      } else {
        console.error("🚨 Unexpected Auth Sign-In Error:", err)
        setErrorMsg("Unable to sign in right now. Please try again.")
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
    } catch (err: unknown) {
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
    <div className="flex w-full flex-col bg-card text-card-foreground">
      <CardHeader className="space-y-1 border-b border-border px-6 pb-6 pt-8 sm:px-10">
        
        {/* Brand mark and accessible text wordmark */}
        <div className="mb-4 flex w-44 flex-col items-center justify-center gap-1 justify-self-center">
          <div className="h-24 w-full overflow-hidden" aria-hidden="true">
            <img
              src="/KOBA-I Audio Logo Latest.png"
              alt=""
              className="h-full w-full scale-x-[1.24] object-cover object-[center_23%] drop-shadow-md"
            />
          </div>
          <div className="flex w-full items-baseline justify-between" aria-label="KOBA-I Audio">
            <span className="text-2xl font-black tracking-[0.08em] text-card-foreground">KOBA-I</span>
            <span className="text-2xl font-medium tracking-wide text-foreground">Audio</span>
          </div>
        </div>

        <div className="space-y-2 pt-2 text-center">
          <CardTitle className="text-2xl font-semibold tracking-wide text-foreground sm:text-3xl">
            Welcome back
          </CardTitle>
          <p className="text-sm font-medium text-muted-foreground">
            Sign in to manage your books.
          </p>
        </div>
      </CardHeader>

      <CardContent className="px-6 py-6 sm:px-10">
        {/* Custom React Error Alert Card */}
        {errorMsg && (
          <div role="alert" className="mb-6 rounded-md border border-red-500/50 bg-red-500/10 p-4 text-sm leading-relaxed text-red-700 shadow-inner dark:text-red-200">
            <p>{errorMsg}</p>
            {showRecoveryActions && (
              <div className="mt-3 flex flex-wrap gap-4 border-t border-red-500/20 pt-3 text-xs font-semibold">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-red-700 underline underline-offset-4 hover:text-red-900 dark:text-red-200 dark:hover:text-white"
                  onClick={() => {
                    setErrorMsg(null)
                    setShowRecoveryActions(false)
                  }}
                >
                  Try again
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 font-bold text-[#f97316] underline underline-offset-4 hover:text-[#e06613]"
                  onClick={() => onStateChange("reset")}
                >
                  Reset Password
                </Button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-2">
              <Label htmlFor="email" className="font-medium text-foreground">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                disabled={loading}
                required
                className="!border-2 !border-input !bg-muted text-foreground shadow-inner placeholder:text-muted-foreground transition-all focus-visible:!border-[#EFB752] focus-visible:!ring-[#EFB752]/40 dark:!border-[#7084b5] dark:!bg-[#182343] dark:text-white dark:placeholder:text-slate-300"
              />
            </div>
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="font-medium text-foreground">Password</Label>
                <Button 
                  type="button" 
                  variant="link" 
                  className="h-auto p-0 text-xs font-semibold text-foreground transition-colors hover:text-muted-foreground"
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
                className="!border-2 !border-input !bg-muted text-foreground shadow-inner placeholder:text-muted-foreground transition-all focus-visible:!border-[#EFB752] focus-visible:!ring-[#EFB752]/40 dark:!border-[#7084b5] dark:!bg-[#182343] dark:text-white dark:placeholder:text-slate-300"
              />
            </div>
          </div>
          
          <Button 
            className="mt-6 w-full bg-primary py-6 font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:shadow-xl"
            type="submit" 
            disabled={loading}
          >
            {loading ? "Authenticating..." : "Sign In"}
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase font-semibold">
              <span className="bg-card px-3 text-muted-foreground">Or use single sign-on</span>
            </div>
          </div>

          <Button 
            type="button" 
            variant="outline" 
            className="w-full !border-2 !border-border !bg-muted py-6 text-sm font-medium text-foreground shadow-md transition-all hover:!bg-accent hover:text-accent-foreground dark:!border-[#7084b5] dark:!bg-[#182343] dark:text-white dark:hover:!bg-[#22325c] dark:hover:text-white"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg className="mr-3 h-5 w-5" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
              <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 152.6 240 148 224 148c-66.8 0-121.4 54.3-121.4 121.4s54.6 121.4 121.4 121.4c76.2 0 111.7-54.7 116.2-83h-116.2v-85.3h203.2c2.1 11 3 22.6 3 34.7z"></path>
            </svg>
            Continue with Google
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col justify-center gap-2 border-t border-border bg-muted/40 px-6 py-6 sm:flex-row">
        <div className="text-sm text-foreground">
          Don&apos;t have an account?{" "}
          <Button variant="link" className="h-auto p-0 font-bold text-orange-600 hover:text-orange-700 dark:text-orange-300 dark:hover:text-orange-200" onClick={() => onStateChange("signup")}>
            Sign Up
          </Button>
        </div>
      </CardFooter>
    </div>
  )
}
