"use client";

import React, { useState, useEffect } from "react";
import { db, auth } from "@/core/firebase";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { collection, doc, onSnapshot, getDoc, query, where } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/layout"; 
import PaymentReadinessBanner from "@/components/section/dashboard/PaymentReadinessBanner";
import Link from "next/link"; 
import { onAuthStateChanged } from "firebase/auth";
import { Plus, X, UploadCloud, Save, Edit3, Trash2, Globe } from "lucide-react";

interface AuthorIdentityOption {
  id: string;
  displayName: string;
  type: "primary" | "pen_name";
}

export const dynamic = 'force-dynamic';

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any | null>(null);
  const [connectedWpOrigin, setConnectedWpOrigin] = useState("");
  const [authorIdentities, setAuthorIdentities] = useState<AuthorIdentityOption[]>([]);
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
      setConnectedWpOrigin("");
      return;
    }

    const controller = new AbortController();
    fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.authenticated) {
          throw new Error("Your verified publishing site could not be loaded.");
        }
        const targetWpOrigin =
          typeof payload.targetWpOrigin === "string"
            ? payload.targetWpOrigin.trim()
            : "";
        setConnectedWpOrigin(targetWpOrigin);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error("Publishing site lookup failed:", error);
        setConnectedWpOrigin("");
      });

    return () => controller.abort();
  }, [currentUserEmail]);

  useEffect(() => {
    if (!connectedWpOrigin) return;
    setEditingProduct((current: any | null) =>
      current && !current.associatedWebsite
        ? { ...current, associatedWebsite: connectedWpOrigin }
        : current
    );
  }, [connectedWpOrigin]);

  useEffect(() => {
    if (!currentUserEmail) {
      setAuthorIdentities([]);
      return;
    }
    const controller = new AbortController();
    fetch("/api/author-identities", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success || !Array.isArray(payload.identities)) {
          throw new Error(payload?.error || "Your registered author names could not be loaded.");
        }
        setAuthorIdentities(payload.identities);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        toast({
          title: "Author names unavailable",
          description: error instanceof Error ? error.message : "Your author names could not be loaded.",
          variant: "destructive",
        });
      });
    return () => controller.abort();
  }, [currentUserEmail, toast]);

  useEffect(() => {
    if (!currentUserEmail) {
      setProducts([]); 
      return;
    }

    const productsRef = query(
      collection(db, "products"),
      where("authorId", "==", currentUserEmail.toLowerCase())
    );

    const unsubscribe = onSnapshot(productsRef, (snapshot) => {
      const filteredList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setProducts(filteredList);
    }, (error) => {
      console.error("🚨 Staging catalog subscription failed:", error);
    });

    return () => unsubscribe();
  }, [currentUserEmail]);

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
      authorIdentityId: authorIdentities[0]?.id || "primary",
      studioKey: userProfile?.studioKey || "",
      wpStudioKey: userProfile?.studioKey || "",
      associatedWebsite: connectedWpOrigin || userProfile?.associatedWebsite || ""
    });
  };

  const handleEditProduct = (product: any) => {
    setEditingProduct({
      ...product,
      price: product.price ?? product.unitPrice ?? 0,
      studioKey: product.studioKey || userProfile?.studioKey || "",
      wpStudioKey: product.wpStudioKey || product.studioKey || userProfile?.studioKey || "",
      associatedWebsite:
        connectedWpOrigin ||
        product.associatedWebsite ||
        userProfile?.associatedWebsite ||
        "",
      authorIdentityId: product.authorIdentityId || authorIdentities[0]?.id || "primary",
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
        setEditingProduct((prev: any | null) => prev ? ({
          ...prev,
          [type === "cover" ? "coverArtUrl" : "bgImageUrl"]: downloadUrl,
        }) : prev);
        setIsUploading(prev => ({ ...prev, [type]: false }));
      }
    );
  };

  // Path: app/products/page.tsx
// Corrects out-of-bounds deployment parameters to match the KOBA-I Standard

// Path: app/products/page.tsx
// Corrects out-of-bounds deployment parameters to match the KOBA-I Standard

const handleSaveAndDeploy = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!editingProduct) return;
  setIsSaving(true);

  try {
    const numericPrice = Number(editingProduct.price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      throw new Error("Enter a valid product price of zero or greater.");
    }
    // 🎯 REPAIR DEPLOYMENT ARCHITECTURE:
    // Inside your handleSaveAndDeploy routine inside app/products/page.tsx
    const payload = {
      bookTitle: editingProduct.title,
      synopsis: editingProduct.synopsis || editingProduct.description || "",
      coverUrl: editingProduct.coverArtUrl || "", 
      bgImageUrl: editingProduct.bgImageUrl || "", 
      type: editingProduct.type || "audiobook",
      price: numericPrice,
      status: editingProduct.status || "published", 
      authorIdentityId: editingProduct.authorIdentityId || authorIdentities[0]?.id || "primary",
      // 🚀 PRESERVE ASSETS: Include track arrays so downstream endpoints never overwrite them with empty values
      chapters: editingProduct.chapters || [],
      studioTracks: editingProduct.studioTracks || editingProduct.chapters || [],
      ebookPayload: editingProduct.ebookPayload || null,
    };

    // 🎯 Target your high-availability Cloud Run Microservice Engine dynamically
    // The server resolves the author, StudioKey, author identity, and payment tenant.
    // Stripe account IDs and author emails are intentionally never accepted here.
    const cloudResponse = await fetch("/api/agent/deploy", {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });

    const cloudData = await cloudResponse.json().catch(() => null);

    if (!cloudResponse.ok || !cloudData?.success) {
      throw new Error(cloudData?.error || "Your publication could not be saved.");
    }
    const canonicalAssetKey = String(cloudData.assetKey || editingProduct.id);
    const productResponse = await fetch(`/api/products/${encodeURIComponent(canonicalAssetKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        synopsis: payload.synopsis,
        authorIdentityId: payload.authorIdentityId,
      }),
    });
    const productResult = await productResponse.json().catch(() => ({}));
    if (!productResponse.ok || !productResult.success) {
      throw new Error(productResult.error || "The product was deployed, but its synopsis could not be saved.");
    }
    const updatedProduct = productResult.product;
    setProducts((current) => {
      const remaining = current.filter((product) =>
        product.id !== editingProduct.id && product.id !== canonicalAssetKey
      );
      return [...remaining, updatedProduct];
    });
    setEditingProduct(updatedProduct);

    toast({
      title: "Publication Saved",
      description: `Your secure product record ${canonicalAssetKey} is ready.`,
    });

  } catch (err: any) {
    toast({ title: "Deployment Failed", description: err.message, variant: "destructive" });
  } finally {
    setIsSaving(false);
  }
};

  const handleDeleteProduct = async (id: string) => {
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "The product could not be deleted.");
      }
      toast({ title: "Product Deleted", description: "Metadata removed from live Firestore catalogs." });
      setEditingProduct(null);
    } catch (err: any) {
      toast({ title: "Deletion Failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="p-6 space-y-8 max-w-7xl mx-auto">
        <PaymentReadinessBanner />
        
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
            <div><span className="font-semibold text-slate-400">Reader payments:</span> {userProfile.connectionStatus === "active" ? "Ready" : "Setup required"}</div>
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

                  <div className="flex flex-col space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Published author name</label>
                    <select
                      required
                      value={editingProduct.authorIdentityId || authorIdentities[0]?.id || ""}
                      onChange={(e) => setEditingProduct({
                        ...editingProduct,
                        authorIdentityId: e.target.value,
                      })}
                      className="bg-[#222b45] border border-[#40527c] rounded-lg p-2.5 text-white text-sm focus:outline-none focus:border-[#8b4528]"
                    >
                      {authorIdentities.map((identity) => (
                        <option key={identity.id} value={identity.id}>
                          {identity.displayName}{identity.type === "pen_name" ? " (Pen name)" : ""}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] leading-4 text-slate-400">
                      Only author names registered to this individual license may be published.
                    </p>
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
                    <label className="text-xs font-semibold text-slate-300">Associated WordPress Website URL</label>
                    <input 
                      type="url" 
                      readOnly
                      aria-readonly="true"
                      placeholder="Connect your site in Setup & Connections"
                      value={
                        connectedWpOrigin ||
                        editingProduct.associatedWebsite ||
                        ""
                      }
                      className="cursor-default rounded-lg border border-[#40527c]/40 bg-[#1a2138] p-2.5 text-sm text-slate-300 focus:outline-none"
                    />
                    <p className="text-[11px] text-slate-400">
                      Selected automatically from your verified Setup & Connections profile.
                    </p>
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
