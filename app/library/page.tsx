"use client";

import React, { useState, useEffect } from "react";
import { db, auth } from "@/core/firebase";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import Layout from "@/components/layout"; 
import { Package, Headphones, BookOpen, Loader2 } from "lucide-react";

export const dynamic = 'force-dynamic';

export default function BookshelfLibraryPage() {
  // 🚀 Defensive Pre-Rendering Protection: Initialize as empty array to prevent hydration crashes
  const [products, setProducts] = useState<any[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 🚀 Role-Based Data Isolation
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user && user.email) {
        setCurrentUserEmail(user.email);
      } else {
        setCurrentUserEmail(null);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // 🚀 WebSocket Continuous Syncing
  useEffect(() => {
    if (!currentUserEmail) {
      setProducts([]);
      setIsLoading(false);
      return;
    }

    const productsRef = collection(db, "products");
    
    // Strict isolation to the active session to prevent cross-tenant data leaks
    const q = query(productsRef, where("authorEmail", "==", currentUserEmail));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const updatedList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setProducts(updatedList);
      setIsLoading(false);
    }, (error) => {
      console.error("🚨 Bookshelf sync error:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUserEmail]);

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto space-y-8">
        <div className="border-b border-[#40527c]/50 pb-6">
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Package className="w-8 h-8 text-[#8b4528]" />
            Your Content Library
          </h1>
          <p className="text-sm text-slate-300 mt-2">
            Select an asset to launch its immersive Blank Canvas player.
          </p>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mb-4 text-[#8b4528]" />
            <p className="text-sm font-semibold">Syncing library vault...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {/* Defensive rendering via optional chaining mapping */}
            {products?.length === 0 ? (
              <div className="col-span-full border-2 border-dashed border-[#40527c] rounded-xl p-12 text-center text-slate-400">
                Your bookshelf is empty. Assets created in the workbench will appear here automatically.
              </div>
            ) : (
              products?.map((product) => (
                <Link 
                  key={product.id} 
                  href={`/library/${product.id}`}
                  className="group block relative bg-[#2d3b5e] border border-[#40527c] rounded-xl overflow-hidden shadow-lg hover:border-[#8b4528] transition-all"
                >
                  <div className="aspect-[2/3] relative bg-black/40 overflow-hidden">
                    <img 
                      src={product.coverArtUrl || "/placeholder.jpg"} 
                      alt={product.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#2d3b5e] via-transparent to-transparent opacity-90" />
                    
                    <div className="absolute bottom-4 left-4 right-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        {product.type === "audiobook" ? (
                          <span className="bg-emerald-500/20 text-emerald-300 p-1.5 rounded-md backdrop-blur-md border border-emerald-500/30">
                            <Headphones className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <span className="bg-blue-500/20 text-blue-300 p-1.5 rounded-md backdrop-blur-md border border-blue-500/30">
                            <BookOpen className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-white text-lg leading-tight line-clamp-2 drop-shadow-md">
                        {product.title}
                      </h3>
                    </div>
                  </div>
                  <div className="p-4 flex justify-between items-center bg-[#222b45] border-t border-[#40527c]">
                    <span className="text-xs font-mono text-slate-400 uppercase">Open Canvas</span>
                    <span className="text-sm font-semibold text-[#8b4528]">
                      ${Number(product.price || 0).toFixed(2)}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}