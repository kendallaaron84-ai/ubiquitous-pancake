import React, { useState } from "react";
import { doc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "@/core/firebase";
// 🔑 INJECT: Added UI icons for the asset tray
import { Trash2, RefreshCw, ChevronDown, ChevronUp, Copy, ExternalLink } from "lucide-react";

export const dynamic = 'force-dynamic';

interface PipelineItem {
	id: string;
	title: string;
	brandAllocation: string;
	executionState: "initializing" | "processing" | "retrying" | "completed" | "failed";
	// 🔑 INJECT: Added the new omnichannel payload fields to your interface
	liveDraftUrl?: string;
	facebookCopy?: string;
	instagramCopy?: string;
	imagePrompt?: string;
}

export function AuthorPipelineList({ items, onRefresh }: { items: PipelineItem[], onRefresh: () => void }) {
	
	// 🔑 INJECT: State to track which table row has its asset tray open
	const [expandedRow, setExpandedRow] = useState<string | null>(null);

	const toggleRow = (id: string) => {
		setExpandedRow(expandedRow === id ? null : id);
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
	};
	
	// 🗑️ FUNCTION 1: Delete a pipeline trace directly from Firestore
	const handleDelete = async (id: string) => {
		if (!confirm("Are you sure you want to purge this execution blueprint trace?")) return;
		try {
			await deleteDoc(doc(db, "content_blueprints", id));
			onRefresh(); // Refresh layout context array
		} catch (err) {
			console.error("Failed to delete trace document node:", err);
		}
	};

	// 🔁 FUNCTION 2: Fire manual retry loop on the blueprint cluster
	const handleRetry = async (id: string) => {
		try {
			// Pointing strictly to the content blueprints collection
			await updateDoc(doc(db, "content_blueprints", id), {
				executionState: "retrying"
			});
			onRefresh();
			
			// Dispatch actual server-side background bridge execution request fetch loop here
		} catch (err) {
			console.error("Failed to transition state:", err);
		}
	};

	return (
		<div className="overflow-x-auto rounded-xl border border-border bg-card">
			<table className="min-w-full divide-y divide-border text-sm text-left">
				<thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground">
					<tr>
						<th className="p-4">Topic Title / Core Keyword</th>
						<th className="p-4">Brand Allocation</th>
						<th className="p-4">Execution State</th>
						<th className="p-4 text-right">Actions</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-border text-white">
					{items?.map((item) => (
						// 🔑 INJECT: Wrapped in React.Fragment so we can render two table rows for one item
						<React.Fragment key={item.id}>
							<tr className="hover:bg-muted/20 transition-colors">
								<td className="p-4 font-medium max-w-sm truncate">{item.title}</td>
								<td className="p-4 text-muted-foreground">{item.brandAllocation}</td>
								<td className="p-4">
									{/* 🔑 DYNAMIC STATUS BADGE MAPPER */}
									{item.executionState === "initializing" && (
										<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-500/10 text-gray-400 animate-pulse">
											🔄 Initializing
										</span>
									)}
									{item.executionState === "processing" && (
										<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 animate-pulse">
											⚡ Processing
										</span>
									)}
									{item.executionState === "retrying" && (
										<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 animate-pulse">
											⏳ Retrying Bridge
										</span>
									)}
									{item.executionState === "completed" && (
										<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
											✅ Completed
										</span>
									)}
									{item.executionState === "failed" && (
										<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
											❌ Bridge Failure
										</span>
									)}
								</td>
								<td className="p-4 text-right space-x-2 flex justify-end items-center">
									
									{/* 🔑 INJECT: Asset Toggle Button */}
									{item.executionState === "completed" && (item.facebookCopy || item.instagramCopy) && (
										<button 
											onClick={() => toggleRow(item.id)}
											className="inline-flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium rounded-lg transition-all"
										>
											{expandedRow === item.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
											Assets
										</button>
									)}

									{/* 🔑 INJECT: WordPress Draft Link */}
									{item.liveDraftUrl && (
										<a 
											href={item.liveDraftUrl} 
											target="_blank" 
											rel="noreferrer"
											className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary/20 hover:bg-primary text-white text-xs font-medium rounded-lg transition-all"
										>
											<ExternalLink className="h-3 w-3" /> WP Draft
										</a>
									)}

									{item.executionState !== "completed" && (
										<button 
											onClick={() => handleRetry(item.id)}
											className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary/20 hover:bg-primary text-white text-xs font-medium rounded-lg transition-all"
										>
											<RefreshCw className="h-3 w-3" /> Retry
										</button>
									)}
									<button 
										onClick={() => handleDelete(item.id)}
										className="p-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded-lg transition-all"
										title="Purge Trace Log"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</button>
								</td>
							</tr>
							
							{/* 🔑 INJECT: THE EXPANDED TRAY (Uses colSpan to stretch across the whole table) */}
							{expandedRow === item.id && (
								<tr className="bg-muted/5">
									<td colSpan={4} className="p-5 border-t border-border/50">
										<div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-200">
											
											{/* Instagram */}
											{item.instagramCopy && (
												<div className="space-y-1.5">
													<div className="flex items-center justify-between">
														<span className="text-xs font-semibold text-pink-400">Instagram Caption</span>
														<button onClick={() => copyToClipboard(item.instagramCopy!)} className="text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
													</div>
													<div className="p-3 bg-background rounded-lg border border-border text-sm text-foreground whitespace-pre-wrap">
														{item.instagramCopy}
													</div>
												</div>
											)}

											{/* Facebook */}
											{item.facebookCopy && (
												<div className="space-y-1.5">
													<div className="flex items-center justify-between">
														<span className="text-xs font-semibold text-blue-400">Facebook Post</span>
														<button onClick={() => copyToClipboard(item.facebookCopy!)} className="text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
													</div>
													<div className="p-3 bg-background rounded-lg border border-border text-sm text-foreground whitespace-pre-wrap">
														{item.facebookCopy}
													</div>
												</div>
											)}

											{/* Hero Image Prompt (Spans full width if alone) */}
											{item.imagePrompt && (
												<div className="space-y-1.5 md:col-span-2">
													<div className="flex items-center justify-between">
														<span className="text-xs font-semibold text-purple-400">AI Image Prompt (Midjourney/DALL-E)</span>
														<button onClick={() => copyToClipboard(item.imagePrompt!)} className="text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
													</div>
													<div className="p-3 bg-background rounded-lg border border-border text-sm text-muted-foreground font-mono">
														{item.imagePrompt}
													</div>
												</div>
											)}
										</div>
									</td>
								</tr>
							)}
						</React.Fragment>
					))}
				</tbody>
			</table>
		</div>
	);
}