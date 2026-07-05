"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Loader2 } from "lucide-react";
import { db } from "@/core/firebase";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";

export default function ProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && user.email) {
        setEmail(user.email);
        try {
          // Fetch user metadata profile from Firestore
          const docRef = doc(db, "users", user.email);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFirstName(data.firstName || "");
            setLastName(data.lastName || "");
            setCompany(data.company || "");
          }
        } catch (err) {
          console.error("Failed to load user profile context:", err);
        } finally {
          setLoading(false);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSaveChanges = async () => {
    if (!email) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, "users", email),
        { firstName, lastName, company },
        { merge: true }
      );
      toast({
        title: "Profile Synchronized",
        description: "Your master operator configuration was updated safely.",
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Database Constraint Fault",
        description: "Failed to write updates back to the primary cluster.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8 text-sm text-muted-foreground animate-pulse">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Resolving profile ledger details...
      </div>
    );
  }

  return (
    <Card className="bg-card border-border text-white">
      <CardHeader>
        <CardTitle>Operator Control Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="first-name">First Name</Label>
            <Input 
              id="first-name" 
              value={firstName} 
              onChange={(e) => setFirstName(e.target.value)}
              className="bg-background text-white border-border"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last-name">Last Name</Label>
            <Input 
              id="last-name" 
              value={lastName} 
              onChange={(e) => setLastName(e.target.value)}
              className="bg-background text-white border-border"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Active Operator Session Email</Label>
          <Input 
            id="email" 
            type="email" 
            value={email} 
            disabled 
            className="bg-muted/40 text-muted-foreground border-border cursor-not-allowed" 
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company">Company / Publisher Entity</Label>
          <Input 
            id="company" 
            value={company} 
            onChange={(e) => setCompany(e.target.value)}
            className="bg-background text-white border-border"
          />
        </div>
        <Button onClick={handleSaveChanges} disabled={saving} className="font-bold gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
        </Button>
      </CardContent>
    </Card>
  );
}