"use client";

import React, { useState, useEffect } from "react";
import { db, auth } from "@/core/firebase";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/layout"; 
import Link from "next/link"; 
import { Plus, Image as ImageIcon, Settings2, Tag, X, UploadCloud, Save, Edit3, Mic, Trash2 } from "lucide-react";

export const dynamic = 'force-dynamic';

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const userEmail = auth.currentUser?.email || "kendallaaron84@gmail.com";
    const productsRef = collection(db, "products");
    const q = query(productsRef, where("authorEmail", "==", userEmail));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        // 🚀 FIXED: Standardized to completely overwrite array contents, avoiding stacking duplicates
        const updatedList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setProducts(updatedList);
      } else {
        setProducts([]); 
      }
    }, (error) => {
      console.error("Snapshot Stream Rejected:", error);
    });

    return () => unsubscribe();
  }, []); 

  const [isUploading, setIsUploading] = useState<{ cover: boolean; bg: boolean }>({ cover: false, bg: false });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetField: "coverUrl" | "bgImageUrl") => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!editingProduct) {
      toast({ title: "Configuration Missing", description: "Initialize an asset row instance before streaming file components.", variant: "destructive" });
      return;
    }

    let finalAssetKey = editingProduct.assetKey?.trim();
    if (!finalAssetKey || finalAssetKey.startsWith("asset_new_link")) {
      const safeTitle = (editingProduct.title || "new_asset").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, '');
      finalAssetKey = `abk_kendall_${safeTitle}`;
    }

    const isCover = targetField === "coverUrl";
    setIsUploading(prev => ({ ...prev, [isCover ? "cover" : "bg"]: true }));

    toast({ title: "Uploading Asset", description: `Streaming binary components to cloud storage vault...` });

    try {
      const storageInstance = getStorage();
      const storagePath = `assets/${finalAssetKey}_${targetField}_${file.name}`;
      const storageRef = ref(storageInstance, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        null,
        (error) => {
          console.error("Storage vault write rejected:", error);
          toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
          setIsUploading(prev => ({ ...prev, [isCover ? "cover" : "bg"]: false }));
        },
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          setEditingProduct((prev: any) => ({
            ...prev,
            id: finalAssetKey,
            assetKey: finalAssetKey,
            [targetField]: downloadUrl
          }));

          toast({ 
            title: "Asset Sync Complete", 
            description: `${isCover ? "Cover Art" : "Backdrop image"} bound to temporary configuration session.` 
          });
          setIsUploading(prev => ({ ...prev, [isCover ? "cover" : "bg"]: false }));
        }
      );
    } catch (error: any) {
      console.error("Storage interaction fault:", error);
      setIsUploading(prev => ({ ...prev, [isCover ? "cover" : "bg"]: false }));
    }
  };

  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    setIsSaving(true);
    try {
      const userEmail = auth.currentUser?.email || "kendallaaron84@gmail.com";
      const userName = auth.currentUser?.displayName || "Kendall Aaron";

      let finalAssetKey = editingProduct.assetKey?.trim();
      if (!finalAssetKey || finalAssetKey.startsWith("asset_new_link")) {
        const safeTitle = editingProduct.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, '');
        finalAssetKey = `abk_kendall_${safeTitle}`;
      }

      const productDocRef = doc(db, "products", finalAssetKey);
      
      const processedEbookPayload = editingProduct.type === "E-Book" 
        ? (editingProduct.ebookPayload || {
            fontPreference: "Atkinson Hyperlegible",
            chapters: [
              {
                id: `${finalAssetKey}_ebk_ch1`,
                title: "Chapter 1: Rain-Slicked Subnets",
                textContent: "The corporate neon reflected heavily in the pooling oil along the lower balcony floors..."
              }
            ]
          })
        : null;

      const updatedData: any = {
        id: finalAssetKey,
        title: editingProduct.title || "",
        assetKey: finalAssetKey,
        type: editingProduct.type || "Audiobook",
        price: editingProduct.price || "0.00",
        status: editingProduct.status || "Draft",
        stripeConnectId: editingProduct.stripeConnectId || "",
        wpStudioKey: editingProduct.wpStudioKey || "",
        vaultPath: editingProduct.vaultPath || `gs://vault-storage/kendall/${finalAssetKey}`,
        authorEmail: userEmail,
        authorName: userName,
        synopsis: editingProduct.synopsis || "",
        sections: editingProduct.sections || ["Featured Publications"],
        coverUrl: editingProduct.coverUrl || "",
        bgImageUrl: editingProduct.bgImageUrl || "",
        createdAt: editingProduct.createdAt || new Date().toISOString()
      };

      if (processedEbookPayload) {
        updatedData.ebookPayload = processedEbookPayload;
      }

      if (editingProduct.studioTracks) {
        updatedData.studioTracks = editingProduct.studioTracks;
      }

      await setDoc(productDocRef, updatedData, { merge: true });

      // Clean up legacy or placeholder document if the document ID changed
      if (editingProduct.id && editingProduct.id !== finalAssetKey) {
        await deleteDoc(doc(db, "products", editingProduct.id));
      }

      if (updatedData.status === "Active") {
        toast({ title: "Agent Awakening", description: "Broadcasting metadata straight to the WordPress pipeline..." });
        
        const agentResponse = await fetch("/api/agent/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetKey: updatedData.assetKey,
            authorEmail: updatedData.authorEmail,
            authorName: updatedData.authorName,
            bookTitle: updatedData.title,
            price: updatedData.price,
            type: updatedData.type,
            synopsis: updatedData.synopsis,
            sections: updatedData.sections,
            wpStudioKey: updatedData.wpStudioKey,
            stripeConnectId: updatedData.stripeConnectId,
            coverUrl: updatedData.coverUrl,
            bgImageUrl: updatedData.bgImageUrl,
            ebookPayload: updatedData.ebookPayload,
            studioTracks: updatedData.studioTracks || null
          })
        });

        const agentResult = await agentResponse.json();
        if (agentResult.success) {
          toast({
            title: "WordPress Canvas Built",
            description: `Agent verified link deployment: ${agentResult.assetKey}`,
          });
        }
      } else {
        toast({ title: "Draft Saved", description: "Product saved locally. Set to Active to deploy to WordPress." });
      }

      setEditingProduct(null);
    } catch (error: any) {
      console.error("Pipeline failure:", error);
      toast({ title: "Sync Exception", description: error.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm("Are you sure you want to permanently erase this product instance?")) return;
    try {
      await deleteDoc(doc(db, "products", productId));
      toast({ title: "Product Deleted", description: "Asset parameters cleared out of cloud cores." });
      setEditingProduct(null);
    } catch (error: any) {
      toast({ title: "Deletion Refused", description: error.message, variant: "destructive" });
    }
  };

  const handleCreateProductPlaceholder = () => {
    const newId = `prod_${Math.random().toString(36).substring(2, 8)}`;
    setEditingProduct({
      id: newId,
      assetKey: "",
      title: "New Provisioned Asset Template",
      type: "Audiobook",
      price: "18.00",
      status: "Draft",
      stripeConnectId: "acct_1TdEzNAfHyixYIkp", 
      wpStudioKey: "JUBI-TEST-1234-5678",
      vaultPath: "",
      synopsis: ""
    });
  };

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto text-white font-sans min-h-[calc(100vh-4rem)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Product Catalog</h1>
            <p className="text-sm text-muted-foreground">Manage system assets and platform automation targets.</p>
          </div>
          <button onClick={handleCreateProductPlaceholder} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md">
            <Plus className="w-4 h-4" /> Create New Product
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-2">
          {products.map((product) => (
            <div key={product.id} className="group flex flex-col bg-card rounded-2xl overflow-hidden border border-border/80 hover:border-emerald-500/30 hover:shadow-xl transition-all duration-300">
              <div className="h-40 bg-slate-950 flex items-center justify-center relative border-b border-border/40">
                {product.coverUrl ? (
                  <img src={product.coverUrl} alt={product.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-muted-foreground group-hover:text-slate-300 transition-colors">
                    <ImageIcon className="w-7 h-7 mb-2 opacity-40 group-hover:scale-105 transition-transform" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Upload Cover Art</span>
                  </div>
                )}
                <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur-md border border-border px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-sm">
                  <Tag className="w-3 h-3 text-emerald-400" />
                  <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider font-mono">{product.type}</span>
                </div>
              </div>

              <div className="p-5 flex flex-col flex-grow space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <h3 className="text-base font-bold text-white truncate pr-2 tracking-tight">{product.title}</h3>
                  <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full ${product.status === "Active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>{product.status}</span>
                </div>
                <div className="flex items-center">
                  <span className="text-[10px] font-mono text-muted-foreground bg-slate-950/80 px-2.5 py-1 rounded-lg border border-border/60">ID: {product.assetKey}</span>
                </div>
                <div className="pt-3 border-t border-border/40 flex items-center justify-between mt-auto">
                  <span className="text-base font-extrabold text-white font-mono">${product.price}</span>
                  <button onClick={() => setEditingProduct({ ...product })} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-emerald-400 transition-colors">
                    <Settings2 className="w-3.5 h-3.5" /> Edit Details
                  </button>
                </div>
              </div>
              <div className="p-4 border-t border-border/50 flex flex-col gap-2 bg-slate-900/50 mt-auto">
                  <Link href={`/workbench/${product.id}`} className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors">
                      <Edit3 className="w-3.5 h-3.5" /> Author Workbench
                  </Link>
                  <Link href={`/studio/${product.id}`} className="w-full flex items-center justify-center gap-2 bg-[#7C2B22] hover:bg-[#5a1f18] text-[#F9B437] py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors">
                      <Mic className="w-3.5 h-3.5" /> Production Studio
                  </Link>
              </div>
            </div>
          ))}
        </div>

        {editingProduct && (
          <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-slate-950/40">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold uppercase tracking-wider text-white">Asset Parameters Context</h2>
                </div>
                <button onClick={() => setEditingProduct(null)} className="text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
              </div>

              <div className="p-6 overflow-y-auto space-y-5 bg-slate-950/10">
                <form id="edit-form" onSubmit={handleSaveChanges} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-900/20 p-4 rounded-xl border border-border/40">
                    <div className="sm:col-span-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Display Details</h3>
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Display Title</label>
                      <input type="text" value={editingProduct.title || ""} onChange={(e) => setEditingProduct({...editingProduct, title: e.target.value})} className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-sm text-white" />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">System Asset Identifier (Asset Key / Slug)</label>
                      <input type="text" value={editingProduct.assetKey || ""} onChange={(e) => setEditingProduct({...editingProduct, assetKey: e.target.value})} className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-xs font-mono text-white" placeholder="e.g. abk_kendall_this_is_only_the_beginning" />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Product Category</label>
                      <select value={editingProduct.type || "Audiobook"} onChange={(e) => setEditingProduct({...editingProduct, type: e.target.value})} className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-sm text-white">
                        <option value="Audiobook">Audiobook</option>
                        <option value="E-Book">E-Book</option>
                        <option value="Plugin">Plugin License</option>
                        <option value="Course">Coaching Course</option>
                      </select>
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Synopsis</label>
                      <textarea value={editingProduct.synopsis || ""} onChange={(e) => setEditingProduct({...editingProduct, synopsis: e.target.value})} className="w-full h-20 bg-slate-950 border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none" placeholder="Enter book summary context..." />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Retail Price</label>
                      <input type="text" value={editingProduct.price || ""} onChange={(e) => setEditingProduct({...editingProduct, price: e.target.value})} className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-sm text-white font-mono" />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Visibility Status</label>
                      <select value={editingProduct.status || "Draft"} onChange={(e) => setEditingProduct({...editingProduct, status: e.target.value})} className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-sm text-white">
                        <option value="Draft">Draft (Internal Safe)</option>
                        <option value="Active">Active (Public View)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-4 bg-slate-900/40 p-4 rounded-xl border border-border/80 shadow-md">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">Umbrella Gateway Settings</h3>
                      <p className="text-[10px] text-slate-500 mt-0.5">Configure live deployment linkages for individual author accounts.</p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Stripe Connect ID (Sub-Merchant Link)</label>
                      <input type="text" value={editingProduct.stripeConnectId || ""} onChange={(e) => setEditingProduct({...editingProduct, stripeConnectId: e.target.value})} className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-sm text-white font-mono tracking-wide" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">WordPress Studio Key</label>
                        <input type="text" value={editingProduct.wpStudioKey || ""} onChange={(e) => setEditingProduct({...editingProduct, wpStudioKey: e.target.value})} className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-sm text-white font-mono" />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Voice Vault Storage Location</label>
                        <input type="text" value={editingProduct.vaultPath || ""} onChange={(e) => setEditingProduct({...editingProduct, vaultPath: e.target.value})} className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-xs text-slate-400 font-mono" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900/20 p-4 rounded-xl border border-border/40">
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Cover Art File Stream</label>
                    <input type="file" id="koba-cover-file-input" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "coverUrl")} />
                    <div onClick={() => document.getElementById("koba-cover-file-input")?.click()} className="w-full h-24 border border-dashed border-border rounded-xl hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all flex flex-col items-center justify-center cursor-pointer group bg-slate-950/40 relative overflow-hidden">
                      {editingProduct.coverUrl ? (
                        <div className="absolute inset-0 flex items-center justify-between p-4 bg-slate-900/90">
                          <img src={editingProduct.coverUrl} className="h-16 w-16 object-cover rounded border border-border" alt="Preview" />
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">✅ Stream Link Ready</span>
                        </div>
                      ) : (
                        <>
                          <UploadCloud className={`w-5 h-5 text-muted-foreground group-hover:text-emerald-400 mb-1 transition-colors ${isUploading.cover ? "animate-pulse" : ""}`} />
                          <span className="text-xs text-slate-300 font-medium group-hover:text-emerald-300">
                            {isUploading.cover ? "Streaming to storage..." : "Click to upload or execute asset drag"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-900/20 p-4 rounded-xl border border-border/40 mt-4">
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Immersive Player Background Stream</label>
                    <input type="file" id="koba-bg-file-input" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "bgImageUrl")} />
                    <div onClick={() => document.getElementById("koba-bg-file-input")?.click()} className="w-full h-24 border border-dashed border-border rounded-xl hover:border-orange-500/40 hover:bg-orange-500/5 transition-all flex flex-col items-center justify-center cursor-pointer group bg-slate-950/40 relative overflow-hidden">
                      {editingProduct.bgImageUrl ? (
                        <div className="absolute inset-0 flex items-center justify-between p-4 bg-slate-900/90">
                          <img src={editingProduct.bgImageUrl} className="h-16 w-28 object-cover rounded border border-border" alt="Preview" />
                          <span className="text-[10px] font-mono text-orange-400 font-bold">✅ Backdrop Connected</span>
                        </div>
                      ) : (
                        <>
                          <UploadCloud className={`w-5 h-5 text-muted-foreground group-hover:text-orange-400 mb-1 transition-colors ${isUploading.bg ? "animate-pulse" : ""}`} />
                          <span className="text-xs text-slate-300 font-medium group-hover:text-orange-300">
                            {isUploading.bg ? "Streaming to storage..." : "Upload backdrop image for universal glassmorphism"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </form>
              </div>

              <div className="px-6 py-4 border-t border-border bg-slate-950/40 flex justify-between items-center">
                {!(editingProduct?.id?.startsWith("asset_new_link") ?? true) ? (
                  <button type="button" onClick={() => handleDeleteProduct(editingProduct.id)} className="flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" /> Delete Product
                  </button>
                ) : <div />}
                
                <div className="flex gap-3">
                  <button onClick={() => setEditingProduct(null)} className="px-4 py-2 text-xs font-bold text-muted-foreground">Cancel</button>
                  <button type="submit" form="edit-form" disabled={isSaving} className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-bold">
                    <Save className="w-3.5 h-3.5" /> {isSaving ? "Synchronizing..." : "Save & Deploy"}
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