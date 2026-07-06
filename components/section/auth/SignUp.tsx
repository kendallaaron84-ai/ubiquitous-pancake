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
      setErrorMsg("Security Passwords do not match.")
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
        setErrorMsg("An identity with this email address already exists.")
      } else if (authErr.code === "auth/invalid-email") {
        setErrorMsg("Please enter a valid email address.")
      } else if (authErr.code === "auth/weak-password") {
        setErrorMsg("Security Password is too weak. Please include letters, numbers and special characters.")
      } else {
        setErrorMsg(authErr.message || "An unexpected registration error occurred.")
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
            Workspace Provisioning
          </CardTitle>
          <p className="text-sm text-slate-300 font-medium">
            Register New Operator Identity
          </p>
        </div>
      </CardHeader>

      <CardContent className="px-6 sm:px-10 py-6 flex-grow">
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
                className="bg-[#222b45] border-[#40527c] text-white placeholder:text-slate-500 focus-visible:ring-[#8b4528] focus-visible:border-[#8b4528] transition-all"
              />
            </div>
            <div className="flex flex-col space-y-2">
              <Label htmlFor="password" className="text-slate-200 font-medium">Security Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
                className="bg-[#222b45] border-[#40527c] text-white placeholder:text-slate-500 focus-visible:ring-[#8b4528] focus-visible:border-[#8b4528] transition-all"
              />
              <div className="pt-1">
                <PasswordStrengthMeter password={password} />
              </div>
            </div>
            <div className="flex flex-col space-y-2">
              <Label htmlFor="confirm-password" className="text-slate-200 font-medium">Confirm Security Password</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                required
                className="bg-[#222b45] border-[#40527c] text-white placeholder:text-slate-500 focus-visible:ring-[#8b4528] focus-visible:border-[#8b4528] transition-all"
              />
            </div>
            <div className="flex flex-col space-y-2">
              <Label htmlFor="phone" className="text-slate-200 font-medium">Mobile Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
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
            {loading ? "Provisioning Workspace..." : "Establish Workspace Identity"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row justify-center gap-2 px-6 py-6 bg-[#222b45]/50 border-t border-[#40527c]/50 mt-auto">
        <div className="text-sm text-slate-300">
          Already an Operator?{" "}
          <Button variant="link" className="h-auto p-0 font-bold text-[#8b4528] hover:text-[#a65331]" onClick={() => onStateChange("signin")}>
            Sign In
          </Button>
        </div>
      </CardFooter>
    </div>
  )
}
```