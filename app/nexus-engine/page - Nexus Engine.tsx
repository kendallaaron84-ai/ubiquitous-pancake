"use client";

import React, { useState, useEffect } from "react";
import Layout from "@/components/layout"; // 🔑 The corrected wrapper path!
import { AuthorIntakeForm } from "@/components/author-intake-form";
import { BrandProfileModal } from "@/components/brand-profile-modal"; 
import { AdminControlsModal } from "@/components/admin-controls-modal"; 
import { AuthorPipelineList } from "@/components/author-pipeline-list";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";

export default function NexusEnginePage() {
	const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
	const [pipelineItems, setPipelineItems] = useState<any[]>([]);
	const [loadingAuth, setLoadingAuth] = useState(true);

	// 1. Establish Secure Identity Handshake Loop
	useEffect(() => {
		const auth = getAuth();
		const unsubscribe = onAuthStateChanged(auth, (user) => {
			if (user && user.email) {
				setCurrentUserEmail(user.email);
			} else {
				setCurrentUserEmail(null);
			}
			setLoadingAuth(false);
		});
		return () => unsubscribe();
	}, []);

	// 2. Real-Time Sync Stream for the Content Engine Queue
	useEffect(() => {
		if (!currentUserEmail) return;

		const q = query(
			collection(db, "content_blueprints"),
			where("authorEmail", "==", currentUserEmail),
			orderBy("createdAt", "desc")
		);

		const unsubscribe = onSnapshot(q, (snapshot) => {
			const items: any[] = [];
			snapshot.forEach((doc) => {
				const data = doc.data();
				items.push({
					id: doc.id,
					title: data.topicTitle || "Untitled Blueprint",
					brandAllocation: data.brandAllocation || "personal",
					executionState: data.executionState || "initializing",
					// 🔑 Pull down the new assets!
					liveDraftUrl: data.liveDraftUrl || null,
					facebookCopy: data.facebookCopy || null,
					instagramCopy: data.instagramCopy || null,
					imagePrompt: data.imagePrompt || null,
				});
			});
			setPipelineItems(items);
		}, (error) => {
			console.error("❌ Live pipeline sync engine fault:", error);
		});

		return () => unsubscribe();
	}, [currentUserEmail]);

	// Evaluate admin gate privileges
	const isAdmin = currentUserEmail === "kendall.aaron@koba-i.com";

	if (loadingAuth) {
		return (
			<Layout>
				<div className="p-12 text-center text-sm text-muted-foreground animate-pulse">
					Authenticating secure operator studio parameters...
				</div>
			</Layout>
		);
	}

	return (
		<Layout>
			<div className="p-6 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-300">
				
				{/* Header Branding Row */}
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-white">KOBA-I Nexus Engine</h1>
					<p className="text-sm text-muted-foreground">
						Deploy automated blueprints and monitor real-time generation queues across brand vectors.
					</p>
				</div>

				{/* Intake Form & Operational Metadata Parameters */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
					{/* Left Column: The Generator Form */}
					<div className="lg:col-span-2">
						<AuthorIntakeForm />
					</div>
					
					{/* Right Column: Standardized Theme Context Box */}
					<div className="p-5 bg-card rounded-xl border border-border space-y-4 text-sm text-muted-foreground shadow-sm">
						<h3 className="font-bold text-foreground">Operational Parameters</h3>
						<p>Your input triggers the live Cloud Run runtime execution loop matching your active brand settings.</p>
						
						<div className="pt-3 border-t border-border space-y-1 text-xs">
							<div><span className="font-semibold text-foreground">Active Database:</span> content-engine-prod</div>
							<div className="truncate"><span className="font-semibold text-foreground">Operator Session:</span> {currentUserEmail}</div>
						</div>
						
						{/* Brand Profile & Identity Setup Actions */}
						<div className="pt-2 space-y-2">
							<BrandProfileModal />
							{isAdmin && <AdminControlsModal />}
						</div>
					</div>
				</div>

				{/* Active Live Pipeline Generation Tracker Section */}
				<div className="space-y-3 pt-4">
					<div>
						<h2 className="text-xl font-bold tracking-tight text-white">Live Execution Blueprints</h2>
						<p className="text-xs text-muted-foreground">Monitored pipeline traces executing across the CDN.</p>
					</div>
					
					{/* Inject clean data stream elements directly into list layout context */}
					<AuthorPipelineList items={pipelineItems} onRefresh={() => {}} />
				</div>

			</div>
		</Layout>
	);
}