"use client";

import React, { useState, useEffect } from "react";
import { db } from "@/core/firebase";
import { collection, onSnapshot, query } from "firebase/firestore";
import { DollarSign, Target, ShoppingCart, Music } from "lucide-react";

interface SaleLead {
  id: string;
  clientName: string;
  productType: "plugin_sale" | "audiobook_creation";
  stage: "Lead" | "Proposal" | "Won";
  value: number;
}

export function SalesFunnelDashboard() {
  const [leads, setLeads] = useState<SaleLead[]>([]);
  const MONTHLY_SALES_GOAL = 5000; // You can change this to your specific baseline target

  useEffect(() => {
    const q = query(collection(db, "sales_pipeline"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: SaleLead[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as SaleLead);
      });
      setLeads(list);
    });
    return () => unsubscribe();
  }, []);

  // Compute live pipeline calculations
  const totalRevenue = leads.filter(l => l.stage === "Won").reduce((acc, curr) => acc + curr.value, 0);
  const activePipelineValue = leads.filter(l => l.stage === "Proposal").reduce((acc, curr) => acc + curr.value, 0);
  const pluginSalesCount = leads.filter(l => l.productType === "plugin_sale" && l.stage === "Won").length;
  const audiobookCreationsCount = leads.filter(l => l.productType === "audiobook_creation" && l.stage === "Won").length;
  const goalProgressPercentage = Math.min((totalRevenue / MONTHLY_SALES_GOAL) * 100, 100);

  return (
    <div className="space-y-6">
      {/* 📊 Row 1: High-Level Sales Funnel KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-zinc-400 text-xs font-semibold">
            <span>TOTAL REVENUE (WON)</span>
            <DollarSign className="w-4 h-4 text-green-500" />
          </div>
          <div className="text-2xl font-bold text-white">${totalRevenue.toLocaleString()}</div>
        </div>

        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-zinc-400 text-xs font-semibold">
            <span>ACTIVE PROPOSALS</span>
            <Target className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-white">${activePipelineValue.toLocaleString()}</div>
        </div>

        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-zinc-400 text-xs font-semibold">
            <span>PLUGIN SALES</span>
            <ShoppingCart className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold text-white">{pluginSalesCount} Units</div>
        </div>

        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-zinc-400 text-xs font-semibold">
            <span>AUDIOBOOK CREATIONS</span>
            <Music className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-2xl font-bold text-white">{audiobookCreationsCount} Projects</div>
        </div>
      </div>

      {/* 🎯 Row 2: Sales Goal Tracking Matrix */}
      <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl space-y-3">
        <div className="flex justify-between items-center text-sm">
          <span className="font-bold text-white">Monthly Sales Target Performance</span>
          <span className="font-mono text-xs text-zinc-400">
            ${totalRevenue.toLocaleString()} / ${MONTHLY_SALES_GOAL.toLocaleString()} ({goalProgressPercentage.toFixed(0)}%)
          </span>
        </div>
        <div className="w-full h-3 bg-zinc-950 border border-zinc-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-600 transition-all duration-500" 
            style={{ width: `${goalProgressPercentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}