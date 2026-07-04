import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Logo } from "@/components/elements/logo";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({ title: "Validation Error", description: "Please fill out all fields.", variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();

      const apiResponse = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      });

      if (!apiResponse.ok) throw new Error("Server rejected identity exchange token verification.");
      
      toast({ title: "Session Verified", description: "Welcome to the KOBA-I Audio Control Studio." });

      // Give the browser time to save the cookie we just sent it
      setTimeout(() => {
        window.location.href = "/";
      }, 500);

    } catch (error: any) {
      console.error("Authentication failed:", error);
      toast({ title: "Authentication Failed", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 p-8 bg-card rounded-2xl border border-border shadow-xl">
        
        <div className="flex flex-col items-center space-y-2 text-center">
          <Logo size="lg" vertical={true} />
          <h2 className="mt-4 text-xl font-semibold tracking-tight text-white">Secure Studio Portal</h2>
          <p className="text-xs text-muted-foreground">Authorized Audio Operators Only</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="space-y-4 rounded-md">
            <div className="space-y-2">
              <Label htmlFor="email-address">Email Address</Label>
              <Input
                id="email-address" type="email" required placeholder="operator@koba-i.com"
                value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading}
                className="bg-background text-white"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Security Password</Label>
              <div className="relative flex items-center">
                <Input
                  id="password" type={showPassword ? "text" : "password"} required placeholder="••••••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading}
                  className="bg-background text-white pr-10"
                />
                <button
                  type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-muted-foreground hover:text-white transition-colors focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <Button type="submit" disabled={loading} className="w-full font-medium transition-all">
            {loading ? "Decrypting Session Token..." : "Authenticate Session"}
          </Button>
        </form>
      </div>
    </div>
  );
}