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
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idToken }),
      })

      const text = await response.text()
      let data;
      try {
        data = JSON.parse(text)
      } catch (jsonErr) {
        throw new Error("Server returned a non-JSON response during identity handshake.")
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
    <div className="flex flex-col justify-center h-full">
      <CardHeader className="space-y-1 pb-6">
        <CardTitle className="text-2xl font-bold">Sign In</CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-4 flex-grow">
        {/* Custom React Error Alert Card - Eliminating crashing raw alerts */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded bg-destructive/15 border border-destructive/30 text-destructive text-sm leading-relaxed">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col h-full justify-center">
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div className="flex flex-col space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Button 
                  type="button" 
                  variant="link" 
                  className="h-auto p-0 text-xs text-muted-foreground"
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
              />
            </div>
          </div>
          
          <Button className="w-full mt-6" type="submit" disabled={loading}>
            {loading ? "Authenticating..." : "Sign In"}
          </Button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Button 
            type="button" 
            variant="outline" 
            className="w-full" 
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
              <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 152.6 240 148 224 148c-66.8 0-121.4 54.3-121.4 121.4s54.6 121.4 121.4 121.4c76.2 0 111.7-54.7 116.2-83h-116.2v-85.3h203.2c2.1 11 3 22.6 3 34.7z"></path>
            </svg>
            Sign In with Google
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row justify-between gap-2 px-6 py-4 border-t mt-auto">
        <div className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Button variant="link" className="h-auto p-0 font-semibold" onClick={() => onStateChange("signup")}>
            Sign Up
          </Button>
        </div>
      </CardFooter>
    </div>
  )
}