"use client"

import { PasswordStrengthMeter } from "@/components/section/auth/PasswordStrengthMeter"
import { Button } from "@/components/ui/button"
import { CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dispatch, FormEvent, SetStateAction, useState } from "react"
import { auth } from "@/core/firebase"
import { createUserWithEmailAndPassword, AuthError } from "firebase/auth"
import { useRouter } from "next/navigation"

type AuthState = "signin" | "signup" | "reset" | "verify-phone" | "verify-email" | "success"

interface SignUpProps {
  onStateChange: Dispatch<SetStateAction<AuthState>>
  setPhoneNumber: Dispatch<SetStateAction<string>>
}

export default function SignUp({ onStateChange, setPhoneNumber }: SignUpProps) {
  const router = useRouter()
  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [confirmPassword, setConfirmPassword] = useState<string>("")
  const [phone, setPhone] = useState<string>("")
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

      // Safe redirect upon successful multi-tenant dynamic user auto-provisioning
      router.push("/")
      router.refresh()
    } catch (err: any) {
      console.error("🚨 Handshake Error:", err)
      setErrorMsg(err.message || "Registration succeeded, but backend verification failed. Check your product subscription.")
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.")
      return
    }

    setLoading(true)

    try {
      // 1. Register with Email/Password Client SDK
      const userCredential = await createUserWithEmailAndPassword(auth, email, password)
      const user = userCredential.user

      setPhoneNumber(phone)
      
      // 2. Fetch the fresh client ID Token
      const idToken = await user.getIdToken()

      // 3. Initiate Server Handshake
      await handleTokenExchange(idToken)
    } catch (err: any) {
      console.error("🚨 Registration Error:", err)
      const authErr = err as AuthError

      // User-friendly error mappings
      if (authErr.code === "auth/email-already-in-reply" || authErr.code === "auth/email-already-in-use") {
        setErrorMsg("An account with this email address already exists.")
      } else if (authErr.code === "auth/invalid-email") {
        setErrorMsg("Please enter a valid email address.")
      } else if (authErr.code === "auth/weak-password") {
        setErrorMsg("Password is too weak. Please include letters, numbers and special characters.")
      } else {
        setErrorMsg(authErr.message || "An unexpected registration error occurred.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col justify-center h-full">
      <CardHeader className="space-y-1 pb-6">
        <CardTitle className="text-2xl font-bold">Create an Account</CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-4 flex-grow">
        {/* Custom React Error Alert Card - Eliminating crashing raw alerts */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded bg-destructive/15 border border-destructive/30 text-destructive text-sm leading-relaxed">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col h-full justify-center">
          <div className="grid w-full items-center gap-3">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
              <PasswordStrengthMeter password={password} />
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="Enter your phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>
          
          <Button className="w-full mt-6" type="submit" disabled={loading}>
            {loading ? "Registering account..." : "Sign Up"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row justify-between gap-2 px-6 py-4 border-t mt-auto">
        <div className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Button variant="link" className="h-auto p-0 font-semibold" onClick={() => onStateChange("signin")}>
            Sign In
          </Button>
        </div>
      </CardFooter>
    </div>
  )
}