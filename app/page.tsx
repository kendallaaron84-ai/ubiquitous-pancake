"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation"; // 🔑 Import the App Router navigator
import Layout from "@/components/layout";
import DashboardHeader from "@/components/section/dashboard/DashboardHeader";
import StatCards from "@/components/section/dashboard/StatCards";
import UsageChartSection from "@/components/section/dashboard/UsageChartSection";
import SystemAlerts from "@/components/section/dashboard/SystemAlerts";
import RecentActivity from "@/components/section/dashboard/RecentActivity";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/core/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { Sparkles, FileText, Headphones, Loader2 } from "lucide-react";

export default function Home() {
	const router = useRouter(); // Initialize router hook
	const { toast } = useToast();
	
	// Track local form control states right inline
	const [manuscriptTitle, setManuscriptTitle] = useState("");
	const [targetAuthorEmail, setTargetAuthorEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [isOpen, setIsOpen] = useState(false); // Controls closing the modal block on success

	// 🔑 CLEANING HELPER: Strips invalid control characters like hidden tabs or enters
	const cleanJsonString = (str: string) => {
		return str
			.replace(/[\r\n]+/g, " ") // Turn raw line breaks/Enters cleanly into spaces
			.replace(/[\t]+/g, " ")   // Clear out hidden tab alignments
			.trim();
	};

	const handleLaunchQueue = async (e: React.FormEvent) => {
		e.preventDefault();
		
		// 🚀 RUN SANITIZATION: Clean both fields before validation or processing
		const sanitizedTitle = cleanJsonString(manuscriptTitle);
		const sanitizedEmail = cleanJsonString(targetAuthorEmail).toLowerCase();

		if (!sanitizedTitle || !sanitizedEmail) return;

		setLoading(true);

		try {
			// 🔑 FIRING SCHEMA BUILD: Adds sanitized records straight to Firestore
			await addDoc(collection(db, "audiobook_requests"), {
				title: sanitizedTitle,
				authorEmail: sanitizedEmail,
				currentStage: 1, // Stage 1: Ingestion
				queuePosition: 2, // Standard visual scarcity offset
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp()
			});

			toast({
				title: "Narration Request Logged",
				description: "Initializing multi-tenant baseline tracks inside the audio-narration pipeline.",
			});

			setManuscriptTitle("");
			setTargetAuthorEmail("");
			setIsOpen(false); // Shut the modal overlay

			// 🚀 THE REDIRECT: Safely routes you directly to the Audio-Narration Tracker panel
			router.push("/author-pipeline");

		} catch (error) {
			console.error("Failed to inject tracking collection row: ", error);
			toast({
				title: "Database connection failed",
				description: "Could not allocate metadata boundaries inside Firestore.",
				variant: "destructive",
			});
		} finally {
			setLoading(false);
		}
	};

	return (
		<Layout>
			<div className="space-y-6">
				{/* 1. System Header Row */}
				<DashboardHeader />

				{/* 2. Quick Action Control Strip */}
				<div className="flex flex-wrap gap-4 items-center justify-between p-5 bg-card rounded-xl border shadow-sm">
					<div className="space-y-1">
						<h3 className="font-bold text-sm text-card-foreground">Fulfillment Asset Controls</h3>
						<p className="text-xs text-muted-foreground">Initialize new manuscript production sequences directly on the CDN framework.</p>
					</div>
					
					<div>
						<Dialog open={isOpen} onOpenChange={setIsOpen}>
							<DialogTrigger asChild>
								<Button className="bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-2 text-xs font-semibold py-2 px-4 rounded-lg">
									<Sparkles className="w-4 h-4" /> Request Narration
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Request New Narration Build</DialogTitle>
								</DialogHeader>
								<form className="space-y-4 pt-4" onSubmit={handleLaunchQueue}>
									<div className="space-y-2">
										<label className="text-xs font-semibold text-muted-foreground">Manuscript Title</label>
										<Input 
											placeholder="e.g. Duncan the Man Hunter" 
											value={manuscriptTitle}
											onChange={(e) => setManuscriptTitle(e.target.value)}
											required 
											disabled={loading}
										/>
									</div>
									<div className="space-y-2">
										<label className="text-xs font-semibold text-muted-foreground">Target Author Email</label>
										<Input 
											type="email" 
											placeholder="author@domain.com" 
											value={targetAuthorEmail}
											onChange={(e) => setTargetAuthorEmail(e.target.value)}
											required 
											disabled={loading}
										/>
									</div>
									<Button 
										type="submit" 
										className="w-full bg-primary text-primary-foreground font-bold py-2 rounded-lg flex items-center justify-center gap-2"
										disabled={loading}
									>
										{loading && <Loader2 className="w-4 h-4 animate-spin" />}
										{loading ? "Launching Tracker..." : "Launch Core Queue"}
									</Button>
								</form>
							</DialogContent>
						</Dialog>
					</div>
				</div>

				{/* 3. Top Metric Cards */}
				<StatCards />

				{/* 4. Mid-Section Dashboard Grid */}
				<div className="grid gap-6 xl:grid-cols-3">
					<div className="xl:col-span-2">
						<UsageChartSection />
					</div>
					<SystemAlerts />
				</div>

				{/* 5. Core Feature Engine Status Panels */}
				<div className="grid gap-6 md:grid-cols-2">
					{/* Audiobook Player Module */}
					<div className="p-6 bg-card border rounded-xl shadow-sm space-y-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="p-3 bg-primary/10 text-primary rounded-xl">
									<Headphones className="w-6 h-6" />
								</div>
								<div>
									<h2 className="text-lg font-bold text-card-foreground">Audiobook Player Core</h2>
									<p className="text-xs text-muted-foreground">Manage audio delivery framework endpoints</p>
								</div>
							</div>
							<span className="text-xs bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded-full font-mono">Active</span>
						</div>
						<div className="text-sm text-muted-foreground">
							Tied to your native WordPress audiobook engine. Licenses are signed dynamically per distribution track.
						</div>
					</div>

					{/* E-Reader Application Module */}
					<div className="p-6 bg-card border rounded-xl shadow-sm space-y-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="p-3 bg-primary/10 text-primary rounded-xl">
									<FileText className="w-6 h-6" />
								</div>
								<div>
									<h2 className="text-lg font-bold text-card-foreground">E-Reader Application Engine</h2>
									<p className="text-xs text-muted-foreground">Manage manuscript text syndication matrices</p>
								</div>
							</div>
							<span className="text-xs bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded-full font-mono">Active</span>
						</div>
						<div className="text-sm text-muted-foreground">
							Direct integration layer with WordPress text container rendering blocks. Monitors raw typography scaling.
						</div>
					</div>
				</div>

				{/* 6. Bottom Row: Recent Activity Logs */}
				<div className="grid gap-6 xl:grid-cols-1">
					<RecentActivity />
				</div>
			</div>
		</Layout>
	);
}