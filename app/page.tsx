"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation"; // 🔑 Import the App Router navigator
import Layout from "@/components/layout";
import DashboardHeader from "@/components/section/dashboard/DashboardHeader";
import PaymentReadinessBanner from "@/components/section/dashboard/PaymentReadinessBanner";
import StatCards from "@/components/section/dashboard/StatCards";
import { BookSalesGoals, type BookSalesGoalProduct, ReaderJourney } from "@/components/section/dashboard/UsageChartSection";
import { InfrastructureStatusAlerts, ReadershipTelemetry } from "@/components/section/dashboard/SystemAlerts";
import MarketingBudgetModal from "@/components/section/dashboard/MarketingBudgetModal";
import { useMarketingBudgetPlanner } from "@/components/section/dashboard/useMarketingBudgetPlanner";
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
	const [targetAuthorName, setTargetAuthorName] = useState("");
	const [targetAuthorEmail, setTargetAuthorEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [isOpen, setIsOpen] = useState(false); // Controls closing the modal block on success
	const marketingPlanner = useMarketingBudgetPlanner();
	const activeCatalogProducts: readonly BookSalesGoalProduct[] = marketingPlanner.allProducts.map((product) => ({
		id: product.id,
		name: product.title,
		targetUnits: product.unitPrice > 0
			? Math.ceil(marketingPlanner.budget.annualRevenueGoal / product.unitPrice)
			: null,
		unitPrice: product.unitPrice,
		currentSales: product.currentSales,
		salesGoal: marketingPlanner.budget.annualRevenueGoal,
		status: product.status,
	}));

	// 🔑 CLEANING HELPER: Strips invalid control characters like hidden tabs or enters
	const cleanJsonString = (str: string) => {
		return str
			.replace(/[\u0000-\u001F\u007F]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	};

	const handleLaunchQueue = async (e: React.FormEvent) => {
		e.preventDefault();
		
		// 🚀 RUN SANITIZATION: Clean both fields before validation or processing
		const sanitizedTitle = cleanJsonString(manuscriptTitle);
		const sanitizedName = cleanJsonString(targetAuthorName);
		const sanitizedEmail = cleanJsonString(targetAuthorEmail).toLowerCase();

		if (!sanitizedTitle || !sanitizedEmail) return;
		setLoading(true);

		try {
			// 🔑 FIRING SCHEMA BUILD: Adds sanitized records straight to Firestore
			await addDoc(collection(db, "audiobook_requests"), {
				title: sanitizedTitle,
				authorName: sanitizedName || null,
				authorEmail: sanitizedEmail,
				currentStage: 1, // Stage 1: Ingestion
				queuePosition: 2, // Standard visual scarcity offset
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp()
			});

			toast({
				title: "Narration request received",
				description: "Your audiobook has been added to the production queue.",
			});

			setManuscriptTitle("");
			setTargetAuthorName("");
			setTargetAuthorEmail("");
			setIsOpen(false); // Shut the modal overlay

			// 🚀 THE REDIRECT: Safely routes you directly to the Audio-Narration Tracker panel
			router.push("/author-pipeline");

		} catch (error) {
			console.error("Failed to inject tracking collection row: ", error);
			toast({
				title: "We couldn't submit your request",
				description: error instanceof Error
					? error.message
					: "Please check your connection and try again.",
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
				<PaymentReadinessBanner />

				{/* 2. Quick Action Control Strip */}
				<div className="flex flex-wrap gap-4 items-center justify-between p-5 bg-card rounded-xl border border-border shadow-sm">
					<div className="space-y-1">
						<h3 className="font-bold text-sm text-card-foreground">Audiobooks in Progress</h3>
						<p className="text-xs text-muted-foreground">Start a narration request and follow each audiobook through production.</p>
					</div>
					
					<div>
						<Dialog open={isOpen} onOpenChange={setIsOpen}>
							<DialogTrigger asChild>
								<Button className="bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-2 text-xs font-semibold py-2 px-4 rounded-lg">
									<Sparkles className="w-4 h-4" /> Request Audiobook Narration
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Request Audiobook Narration</DialogTitle>
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
										<label className="text-xs font-semibold text-muted-foreground">Author Name</label>
										<Input
											placeholder="e.g. Sharon Meeks"
											value={targetAuthorName}
											onChange={(e) => setTargetAuthorName(e.target.value)}
										required
											disabled={loading}
										/>
									</div>
									<div className="space-y-2">
										<label className="text-xs font-semibold text-muted-foreground">Author Email</label>
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
										{loading ? "Submitting Request..." : "Start Narration Request"}
									</Button>
								</form>
							</DialogContent>
						</Dialog>
					</div>
				</div>

				{/* 3. Top Metric Cards */}
				<StatCards
					monthlyBudget={marketingPlanner.monthlyBudget}
					onOpenMarketingBudget={() => marketingPlanner.setIsModalOpen(true)}
				/>

				{/* 4. Reader activity and compact sales planning grid */}
				<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,68fr)_minmax(280px,30fr)]">
					<div className="min-w-0 space-y-6">
						<ReaderJourney />
						<BookSalesGoals
							monthlyBudget={marketingPlanner.monthlyBudget}
							annualRevenueGoal={marketingPlanner.budget.annualRevenueGoal}
							bookPrice={marketingPlanner.bookPrice}
							isBookPriceLoading={marketingPlanner.isBookPriceLoading}
							products={activeCatalogProducts}
						/>
					</div>
					<div className="min-w-0 space-y-6">
						<ReadershipTelemetry />
						<InfrastructureStatusAlerts />
					</div>
				</div>

				<MarketingBudgetModal
					open={marketingPlanner.isModalOpen}
					onOpenChange={marketingPlanner.setIsModalOpen}
					plan={marketingPlanner.plan}
					isPlanLoading={marketingPlanner.isPlanLoading}
					subscriptionCost={marketingPlanner.subscriptionCost}
					products={activeCatalogProducts}
					isBookPriceLoading={marketingPlanner.isBookPriceLoading}
					budget={marketingPlanner.budget}
					onBudgetChange={marketingPlanner.setBudget}
				/>

				{/* 5. Core Feature Engine Status Panels */}
				<div className="grid gap-6 md:grid-cols-2">
					{/* Audiobook Player Module */}
					<div className="p-6 bg-card border border-border rounded-xl shadow-sm space-y-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="p-3 bg-primary/10 text-primary rounded-xl">
									<Headphones className="w-6 h-6" />
								</div>
								<div>
									<h2 className="text-lg font-bold text-card-foreground">Audiobook Player</h2>
									<p className="text-xs text-muted-foreground">Manage how readers listen to your audiobooks.</p>
								</div>
							</div>
							<span className="text-xs bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded-full font-mono">Active</span>
						</div>
						<div className="text-sm text-muted-foreground">
							Connected to your WordPress website and ready to deliver authorized audiobook access.
						</div>
					</div>

					{/* E-Reader Application Module */}
					<div className="p-6 bg-card border border-border rounded-xl shadow-sm space-y-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="p-3 bg-primary/10 text-primary rounded-xl">
									<FileText className="w-6 h-6" />
								</div>
								<div>
									<h2 className="text-lg font-bold text-card-foreground">Digital Books</h2>
									<p className="text-xs text-muted-foreground">Manage how your ebooks appear to readers.</p>
								</div>
							</div>
							<span className="text-xs bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded-full font-mono">Active</span>
						</div>
						<div className="text-sm text-muted-foreground">
							Connected to your WordPress website with reader-friendly typography and display controls.
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
