"use client";

import React, { useState, useEffect } from "react";
import { db, auth } from "@/core/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import Layout from "@/components/layout";
import Link from "next/link";
import { Mic, ArrowRight, Tag, Music, Film, Sparkles, BookOpen } from "lucide-react";

export default function ProductionStudioLobby() {
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const userEmail = auth.currentUser?.email || "kendallaaron84@gmail.com";
    const productsRef = collection(db, "products");
    const q = query(productsRef, where("authorEmail", "==", userEmail));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setIsLoading(false);
      if (!snapshot.empty) {
        const updatedList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setProducts(updatedList);
      } else {
        setProducts([]);
      }
    }, (error) => {
      console.error("Snapshot Stream Rejected:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto text-white font-sans min-h-[calc(100vh-4rem)]">
        
        {/* Header Block */}
        <div className="space-y-1.5 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-orange-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-orange-500">Live Recording & Processing</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white uppercase">Production Studio Lobby</h1>
          <p className="text-sm text-slate-400">Select an active publication asset below to launch its master production deck, upload wave files, and sync scripts.</p>
        </div>

        {/* Content Body */}
        {isLoading ? (
          <div className="h-[40vh] flex flex-col items-center justify-center space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
            <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">Syncing Studio Deck...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="h-[40vh] flex flex-col items-center justify-center space-y-4 text-center border border-dashed border-slate-800 rounded-3xl bg-slate-950/20 p-8">
            <Sparkles className="w-10 h-10 text-slate-600 mb-2" />
            <div>
              <h3 className="text-base font-bold text-slate-300">No Master Assets Staged</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">To access production tools, you first need to create a product placeholder within the Catalog deck.</p>
            </div>
            <Link href="/products" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md mt-4">
              Enter Product Catalog
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-2">
            {products.map((product) => (
              <div key={product.id} className="group relative flex flex-col bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden hover:border-orange-500/30 hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-300">
                
                {/* Visual Header */}
                <div className="h-44 bg-slate-950 flex items-center justify-center relative border-b border-slate-800/40 overflow-hidden">
                  {product.coverUrl ? (
                    <>
                      <img src={product.coverUrl} alt={product.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
                    </>
                  ) : (
                    <div className="flex flex-col items-center text-slate-600 group-hover:text-slate-400 transition-colors">
                      <BookOpen className="w-8 h-8 mb-2 opacity-30 group-hover:scale-105 transition-transform" />
                      <span className="text-[9px] font-bold uppercase tracking-widest">No Cover Art Attached</span>
                    </div>
                  )}
                  
                  {/* Category Badge */}
                  <div className="absolute top-3 left-3 bg-slate-950/90 backdrop-blur-md border border-slate-800/80 px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-sm">
                    {product.type === "Video" ? (
                      <Film className="w-3 h-3 text-blue-400" />
                    ) : (
                      <Music className="w-3 h-3 text-orange-400" />
                    )}
                    <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest font-mono">{product.type || "Audiobook"}</span>
                  </div>
                </div>

                {/* Info and Navigation Section */}
                <div className="p-5 flex flex-col flex-grow space-y-4">
                  <div className="space-y-1">
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="text-base font-black text-white truncate pr-2 tracking-tight group-hover:text-orange-400 transition-colors">{product.title}</h3>
                      <span className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded-full ${product.status === "Active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>{product.status}</span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-500">ID: {product.assetKey}</p>
                  </div>

                  {product.synopsis && (
                    <p className="text-xs text-slate-400 line-clamp-2 h-8 leading-relaxed">{product.synopsis}</p>
                  )}

                  <div className="pt-3 border-t border-slate-800/50 mt-auto">
                    <Link href={`/studio/${product.id}`} className="w-full flex items-center justify-center gap-2 bg-[#7C2B22] hover:bg-[#5a1f18] text-[#F9B437] py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-md group-hover:scale-[1.01]">
                      <Mic className="w-3.5 h-3.5" /> Enter Studio Console <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                </div>

              </div>
            ))}
          </div>
        )}

      </div>
    </Layout>
  );
}