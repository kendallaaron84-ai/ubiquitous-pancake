"use client";

import React, { useState, useEffect } from "react";
import { db, auth } from "@/core/firebase";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { collection, doc, deleteDoc, onSnapshot, getDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/layout"; 
import Link from "next/link"; 
import { onAuthStateChanged } from "firebase/auth";
import { Plus, X, UploadCloud, Save, Edit3, Trash2, Globe } from "lucide-react";

export const dynamic = 'force-dynamic';

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ cover: number; bg: number }>({ cover: 0, bg: 0 });
  const [isUploading, setIsUploading] = useState<{ cover: boolean; bg: boolean }>({ cover: false, bg: false });
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user && user.email) {
        setCurrentUserEmail(user.email);
        const userDocRef = doc(db, "users", user.email);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          setUserProfile(userSnap.data());
        }
      } else {
        setCurrentUserEmail(null);
        setUserProfile(null);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!currentUserEmail) {
      setProducts([]); 
      return;
    }

    const productsRef = collection(db, "products");

    const unsubscribe = onSnapshot(productsRef, (snapshot) => {
      const allList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const filteredList = allList.filter((product: any) => {
        const productAuthor = (product.authorId || product.authorEmail || "").toLowerCase();
        const activeEmail = (currentUserEmail || "").toLowerCase();

        if (!activeEmail) return false;
        if (productAuthor === activeEmail) return true;

        const activeStudioKey = userProfile?.studioKey;
        const productKey = product.studioKey || product.wpStudioKey;
        if (activeStudioKey && productKey && productKey === activeStudioKey) return true;

        return false;
      });

      setProducts(filteredList);
    }, (error) => {
      console.error("🚨 Staging catalog subscription failed:", error);
    });

    return () => unsubscribe();
  }, [currentUserEmail, userProfile]);

  const handleCreateDraft = () => {
    const generatedId = `abk_${Math.random().toString(36).substring(2, 9)}`;
    setEditingProduct({
      id: generatedId,
      title: "New Audiobook Draft",
      price: 0.00,
      status: "draft",
      type: "audiobook",
      coverArtUrl: "",
      bgImageUrl: "",
      synopsis: "Draft workspace canvas.",
      studioKey: userProfile?.studioKey || "",
      wpStudioKey: userProfile?.studioKey || "",
      stripeConnectId: userProfile?.stripeConnectId || userProfile?.stripeCustomerId || "",
      associatedWebsite: userProfile?.associatedWebsite || ""
    });
  };

  const handleEditProduct = (product: any) => {
    setEditingProduct({
      ...product,
      studioKey: product.studioKey || userProfile?.studioKey || "",
      wpStudioKey: product.wpStudioKey || product.studioKey || userProfile?.studioKey || "",
      stripeConnectId: product.stripeConnectId || userProfile?.stripeConnectId || "",
      associatedWebsite: product.associatedWebsite || userProfile?.associatedWebsite || ""
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "cover" | "bg") => {
    const file = e.target.files?.[0];
    if (!file || !editingProduct) return;

    setIsUploading(prev => ({ ...prev, [type]: true }));
    setUploadProgress(prev => ({ ...prev, [type]: 0 }));

    const storage = getStorage();
    const fileName = `assets/${editingProduct.id}_${type === "cover" ? "coverUrl" : "bgImageUrl"}_${file.name}`;
    const storageRef = ref(storage, fileName);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(prev => ({ ...prev, [type]: Math.round(progress) }));
      },
      (error) => {
        toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
        setIsUploading(prev => ({ ...prev, [type]: false }));
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        setEditingProduct(prev => ({ ...prev, [type === "cover" ? "coverArtUrl" : "bgImageUrl"]: downloadUrl }));
        setIsUploading(prev => ({ ...prev, [type]: false }));
      }
    );
  };

  const handleSaveAndDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setIsSaving(true);

    try {
      const numericPrice = Number(editingProduct.price);
      if (numericPrice >= 0.50 && !editingProduct.stripeConnectId) {
        throw new Error("A validated Stripe Connect Account ID is required to publish products priced at $0.50 or above.");
      }

      // 🚀 DROPDOWN BUG FIXED: status is now included in the deployment payload
      const payload = {
        assetKey: editingProduct.id,
        bookTitle: editingProduct.title,
        coverUrl: editingProduct.coverArtUrl,
        bgImageUrl: editingProduct.bgImageUrl,
        type: editingProduct.type || "audiobook",
        price: numericPrice,
        status: editingProduct.status || "draft", 
        authorEmail: currentUserEmail,
        stripeConnectId: editingProduct.stripeConnectId || null,
        associatedWebsite: editingProduct.associatedWebsite || null,
        studioTracks: editingProduct.studioTracks || [],
        ebookPayload: editingProduct.ebookPayload || null
      };

      const response = await fetch("/api/agent/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to deploy product asset.");

      toast({
        title: "Deployment Complete",
        description: `Successfully synchronized ${editingProduct.id} with your live storefront.`,
      });

      setEditingProduct(null);
    } catch (err: any) {
      toast({ title: "Deployment Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await deleteDoc(doc(db, "products", id));
      toast({ title: "Product Deleted", description: "Metadata removed from live Firestore catalogs." });
      setEditingProduct(null);
    } catch (err: any) {
      toast({ title: "Deletion Failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="p-6 space-y-8 max-w-7xl mx-auto">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white">Product Catalog</h1>
            <p className="text-sm text-slate-300 mt-1">Manage, update, and deploy physical and digital audio distribution streams.</p>
          </div>
          <button 
            onClick={handleCreateDraft} 
            className="flex items-center gap-2 bg-[#8b4528] text-white hover:bg-[#723820] px-5 py-3 rounded-lg font-semibold shadow-lg transition-all"
          >
            <Plus className="w-4 h-4" /> Add Product Asset
          </button>
        </div>

        {userProfile && (
          <div className="bg-[#222b45]/40 border border-[#40527c]/40 rounded-xl p-4 flex flex-wrap gap-6 text-xs text-slate-300">
            <div><span className="font-semibold text-slate-400">Profile:</span> {currentUserEmail}</div>
            <div><span className="font-semibold text-slate-400">Studio Key:</span> {userProfile.studioKey || "Pending Assignment"}</div>
            <div><span className="font-semibold text-slate-400">Website:</span> {userProfile.associatedWebsite || "Not Connected"}</div>
            <div><span className="font-semibold text-slate-400">Stripe Account:</span> {userProfile.stripeConnectId || userProfile.stripeCustomerId || "Action Required"}</div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.length === 0 ? (
            <div className="col-span-full border-2 border-dashed border-[#40527c] rounded-xl p-12 text-center text-slate-400">
              Your Dynamic Staging Canvas is Empty. Deploy assets through the command center.
            </div>
          ) : (
            products.map((product: any) => (
              <div key={product.id} className="relative group overflow-hidden bg-[#2d3b5e] border border-[#40527c] rounded-xl p-5 shadow-lg flex flex-col justify-between hover:border-[#8b4528]/50 transition-all">
                <div>
                  <div className="relative w-full h-48 rounded-md mb-4 bg-black/25 overflow-hidden">
                    <img 
                      src={product.coverArtUrl || "/placeholder.jpg"} 
                      alt={product.title} 
                      className="w-full h-full object-cover" 
                    />
                    <div className="absolute top-2 right-2 flex gap-1">
                      <span className={`text-[10px] border px-2 py-0.5 rounded font-mono uppercase ${product.status === 'published' ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-400' : 'bg-slate-900/90 border-white/10 text-white'}`}>
                        {product.status || "draft"}
                      </span>
                    </div>
                  </div>
                  <h3 className="font-bold text-lg text-white mb-1 line-clamp-1">{product.title}</h3>
                  <p className="text-xs text-slate-300 font-semibold mb-2">ID: {product.id}</p>
                  
                  {product.associatedWebsite && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
                      <Globe className="w-3.5 h-3.5" />
                      <span className="line-clamp-1">{product.associatedWebsite}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center mt-4">
                    <span className="text-sm bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-md font-semibold">
                      ${Number(product.price).toFixed(2)}
                    </span>
                    <span className="text-xs uppercase bg-[#222b45] text-slate-300 px-2.5 py-1 rounded-md border border-[#40527c]">
                      {product.type || "audiobook"}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-col gap-2 mt-6">
                  <div className="flex gap-2">
                    <Link href={`/studio/${product.id}`} className="flex-1 text-center py-2.5 rounded bg-[#222b45] hover:bg-[#1a2138] text-white text-xs font-semibold border border-[#40527c] transition-all">
                      Open Studio
                    </Link>
                    <Link href={`/workbench/${product.id}`} className="flex-1 text-center py-2.5 bg-[#8b4528] hover:bg-[#723820] text-white rounded text-xs font-semibold transition-all">
                      Workbench
                    </Link>
                  </div>
                  <button 
                    onClick={() => handleEditProduct(product)} 
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold border border-slate-700 flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit Metadata & Assets
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {editingProduct && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-end">
            <div className="w-full max-w-lg bg-[#2d3b5e] border-l border-[#40527c] h-full flex flex-col justify-between overflow-hidden shadow-2xl">
              
              <div className="p-6 border-b border-[#40527c]/50 flex justify-between items-center bg-[#222b45]/40">
                <div>
                  <h2 className="text-xl font-bold text-white">Staging Workbench</h2>
                  <p className="text-xs text-slate-300 mt-0.5">Asset ID: {editingProduct.id}</p>
                </div>
                <button onClick={() => setEditingProduct(null)} className="text-slate-400 hover:text-white p-1 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-grow space-y-6">
                <form id="edit-form" onSubmit={handleSaveAndDeploy} className="space-y-5 text-slate-200">
                  
                  <div className="flex flex-col space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Book Title</label>
                    <input 
                      type="text" 
                      required
                      value={editingProduct.title || ""} 
                      onChange={(e) => setEditingProduct({...editingProduct, title: e.target.value})}
                      className="bg-[#222b45] border border-[#40527c] rounded-lg p-2.5 text-white text-sm focus:outline-none focus:border-[#8b4528]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Price (USD)</label>
                      <input 
                        type="number" 
                        step="0.01" 
                        min="0"
                        required
                        value={editingProduct.price} 
                        onChange={(e) => setEditingProduct({...editingProduct, price: e.target.value})}
                        className="bg-[#222b45] border border-[#40527c] rounded-lg p-2.5 text-white text-sm focus:outline-none focus:border-[#8b4528]"
                      />
                    </div>

                    <div className="flex flex-col space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Media Type</label>
                      <select 
                        value={editingProduct.type || "audiobook"}
                        onChange={(e) => {
                          const newType = e.target.value;
                          const newPrefix = newType === "ebook" ? "ebk_" : "abk_";
                          const currentCleanId = editingProduct.id.replace(/^(abk_|ebk_)/, "");
                          setEditingProduct({
                            ...editingProduct, 
                            type: newType,
                            id: `${newPrefix}${currentCleanId}`
                          });
                        }}
                        className="bg-[#222b45] border border-[#40527c] rounded-lg p-2.5 text-white text-sm focus:outline-none"
                      >
                        <option value="audiobook">Audiobook</option>
                        <option value="ebook">E-Book</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Stripe Connect ID (Required for paid assets)</label>
                    <input 
                      type="text" 
                      placeholder="acct_1XXXXXXXXXXXXXXX"
                      value={editingProduct.stripeConnectId || ""} 
                      onChange={(e) => setEditingProduct({...editingProduct, stripeConnectId: e.target.value})}
                      className="bg-[#222b45] border border-[#40527c] rounded-lg p-2.5 text-white text-sm font-mono focus:outline-none focus:border-[#8b4528]"
                    />
                  </div>

                  <div className="flex flex-col space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Associated WordPress Website URL</label>
                    <input 
                      type="url" 
                      placeholder="https://myauthorwebsite.com"
                      value={editingProduct.associatedWebsite || ""} 
                      onChange={(e) => setEditingProduct({...editingProduct, associatedWebsite: e.target.value})}
                      className="bg-[#222b45] border border-[#40527c] rounded-lg p-2.5 text-white text-sm focus:outline-none focus:border-[#8b4528]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col space-y-1.5">
                      <label className="text-xs font-semibold text-slate-400">Studio Key</label>
                      <input 
                        type="text" 
                        disabled
                        placeholder="Pending Assignment"
                        value={editingProduct.studioKey || ""} 
                        className="bg-[#1a2138] border border-[#40527c]/40 text-slate-400 px-3 py-2.5 rounded-lg text-xs font-semibold font-mono"
                      />
                    </div>
                    <div className="flex flex-col space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Publishing Status</label>
                      <select 
                        value={editingProduct.status || "draft"}
                        onChange={(e) => setEditingProduct({ ...editingProduct, status: e.target.value })}
                        className="bg-[#222b45] border border-[#40527c] text-white p-2.5 rounded-lg text-xs focus:outline-none"
                      >
                        <option value="draft">Draft</option>
                        <option value="ready">Ready to Deploy</option>
                        <option value="published">Published</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-300 block">Cover Artwork (CoverArtUrl)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="Artwork URL" 
                        value={editingProduct.coverArtUrl || ""} 
                        onChange={(e) => setEditingProduct({ ...editingProduct, coverArtUrl: e.target.value })}
                        className="bg-[#222b45] border border-[#40527c] text-slate-100 flex-1 text-xs p-2.5 rounded-lg focus:outline-none focus:border-[#8b4528]"
                      />
                      <label className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2.5 rounded-lg text-xs font-semibold cursor-pointer border border-[#40527c] flex items-center justify-center transition-all select-none">
                        <UploadCloud className="w-4 h-4 mr-1.5 text-slate-400" /> Upload File
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "cover")} />
                      </label>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-300 block">Backdrop Image (BgImageUrl)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="Backdrop URL" 
                        value={editingProduct.bgImageUrl || ""} 
                        onChange={(e) => setEditingProduct({ ...editingProduct, bgImageUrl: e.target.value })}
                        className="bg-[#222b45] border border-[#40527c] text-slate-100 flex-1 text-xs p-2.5 rounded-lg focus:outline-none focus:border-[#8b4528]"
                      />
                      <label className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2.5 rounded-lg text-xs font-semibold cursor-pointer border border-[#40527c] flex items-center justify-center transition-all select-none">
                        <UploadCloud className="w-4 h-4 mr-1.5 text-slate-400" /> Upload File
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "bg")} />
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Book Synopsis</label>
                    <textarea 
                      rows={3}
                      value={editingProduct.synopsis || ""} 
                      onChange={(e) => setEditingProduct({...editingProduct, synopsis: e.target.value})}
                      className="bg-[#222b45] border border-[#40527c] rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-[#8b4528]"
                    />
                  </div>

                </form>
              </div>

              <div className="px-6 py-4 border-t border-[#40527c]/50 bg-[#222b45]/40 flex justify-between items-center">
                {!(editingProduct?.id?.startsWith("abk_") || editingProduct?.id?.startsWith("ebk_")) ? (
                  <div />
                ) : (
                  <button 
                    type="button" 
                    onClick={() => handleDeleteProduct(editingProduct.id)} 
                    className="flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Delete Product
                  </button>
                )}
                
                <div className="flex gap-3">
                  <button onClick={() => setEditingProduct(null)} className="px-4 py-2 text-xs font-bold text-slate-400">Cancel</button>
                  <button 
                    type="submit" 
                    form="edit-form" 
                    disabled={isSaving} 
                    className="flex items-center gap-1.5 bg-[#8b4528] hover:bg-[#723820] text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                  >
                    <Save className="w-4 h-4" /> {isSaving ? "Synchronizing..." : "Save & Deploy"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}