// app/documentation/page.tsx
"use client";

import React, { useState } from "react";
import Layout from "@/components/layout";
import { Database, ShieldAlert, Key, HelpCircle, Layers, Search, ArrowRightLeft, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";


export default function DataDictionaryPage() {
  const [activeTab, setActiveTab] = useState<"products" | "entitlements" | "licenses" | "api_payloads">("products");
  const [searchTerm, setSearchTerm] = useState("");

  const dictionaryData = {
    products: [
      {
        field: "id / assetKey",
        type: "String (Document ID)",
        source: "Next.js Form Engine Match",
        destination: "Firestore / WP Publication Page / Stripe ID Vault",
        description: "The primary tracking identifier string pattern. Links the database product directly to the custom WordPress page context mapping.",
        validation: "Formula: abk_kendall_[book_title_slug]",
        status: "Active Core"
      },
      {
        field: "title / bookTitle",
        type: "String",
        source: "Next.js Form Input Field",
        destination: "Firestore / WP Publication Title / Bookshelf Library",
        description: "The global customer-facing text string representing the publication's name across all platforms.",
        validation: "Required. Sanitized to alphanumeric patterns on save.",
        status: "Active Core"
      },
      {
        field: "price",
        type: "String",
        source: "Next.js Form Input Field",
        destination: "Firestore / Stripe line_items / WP Storefront Buy Now Button",
        description: "Retail asset pricing representation. Parsed to floats for display and integer cents for Stripe processing.",
        validation: "Must map string representation. Free books format specifically as '0.00'.",
        status: "Active Core"
      },
      {
        field: "type",
        type: "String (Enum)",
        source: "Next.js Dropdown Select",
        destination: "Firestore / WP Metadata / Bookshelf Asset Component Router",
        description: "Determines internal parsing matrix paths for player layout containers (e.g., loading audio waves vs reading pages).",
        validation: "Options: 'Audiobook' | 'E-Book' | 'Plugin' | 'Course'",
        status: "Active Core"
      },
      {
        field: "synopsis",
        type: "String (Text Node)",
        source: "Next.js Textarea Block",
        destination: "Firestore / WP Publication Description / Book Details Modal",
        description: "The summary content block describing the narrative context context map.",
        validation: "Optional. Automatically capped or truncated based on display grid dimensions.",
        status: "Active Core"
      },
      {
        field: "sections",
        type: "Array (Strings)",
        source: "Form Multi-Select Checkboxes",
        destination: "Firestore / WP Home Featured Publications Loop Grid",
        description: "Categorization arrays grouping items into active layouts on target store landing displays.",
        validation: "Defaults to ['Featured Publications'] on standard array drop.",
        status: "Active Core"
      },
      {
        field: "coverUrl / bgImageUrl",
        type: "String (Secure URI)",
        source: "Firebase Storage Binary Stream",
        destination: "Firestore / WP Publication Cards / Immersive Glass Player Backdrop",
        description: "GCS download reference pathways feeding image nodes into client viewing cards and immersive background player elements.",
        validation: "Must validate as functional secure URL stream path.",
        status: "Active Core"
      },
      {
        field: "studioTracks",
        type: "Array (Track Dictionary Maps)",
        source: "Production Studio Wave Upload Matrix",
        destination: "Firestore Document / Verify Return / Actual Audiobook Player Engine",
        description: "Array list mapping tracking chapter numbers, durations, and signed file pointers feeding into the audio playback waveform engine.",
        validation: "Optional on creation. Crucial to bypass 'Parsing data...' loading frames on the live player page.",
        status: "Staged Pipeline"
      }
    ],
    entitlements: [
      {
        field: "id",
        type: "String (Document ID)",
        source: "Stripe Webhook / Free Bypass Intercept",
        destination: "Firestore Collection Mapping Key",
        description: "Unique tracking sequence string validating individual digital purchase rows.",
        validation: "Format: ent_free_[random_hash] or Stripe transaction transaction token.",
        status: "Active Core"
      },
      {
        field: "assetKey",
        type: "String (Foreign Key Match)",
        source: "Checkout Context Context Map",
        destination: "Firestore Queries / Verify Check / Bookshelf Unlock Gateway",
        description: "Binds user identity parameters directly back to a target product document row.",
        validation: "Must correspond perfectly to a primary product assetKey mapping.",
        status: "Active Core"
      },
      {
        field: "userEmail",
        type: "String (Query Channel)",
        source: "Stripe Metadata / Frontend Form Post",
        destination: "Firestore Queries / WordPress Context Check",
        description: "Customer email identity signature tracking data parameters.",
        validation: "Normalized to lowercase string context defensively on backend entry parsing.",
        status: "Active Core"
      },
      {
        field: "userPhone",
        type: "String (Query Channel)",
        source: "Stripe Metadata / SMS Verification Code State",
        destination: "Firestore Reference / Twilio Handshake Engine",
        description: "International phone string signature used to match mobile identities.",
        validation: "Defensively standardized: Strip extra signs and force prepending '+1'.",
        status: "Active Core"
      },
      {
        field: "stripeSessionId",
        type: "String",
        source: "Stripe API Checkout Create Event",
        destination: "Firestore / Invoice Lookup Matrix",
        description: "Holds transaction ID markers or system bypass identifiers.",
        validation: "Contains actual 'cs_test_' signature or tracks free items via 'free_bypass_token'.",
        status: "Active Core"
      },
      {
        field: "status",
        type: "String",
        source: "Billing Webhook Event State Processor",
        destination: "Firestore Collection Access Check",
        description: "State field determining whether file generation handshakes are allowed to fire.",
        validation: "Value must equate exactly to lowercase string 'active' to clear player gates.",
        status: "Active Core"
      }
    ],
    licenses: [
      {
        field: "key / wpStudioKey",
        type: "String (Secret Passkey)",
        source: "User Onboarding Generation / Catalog Parameter Input",
        destination: "Firestore products Collection / Next.js Agent Outbound Request Header",
        description: "The secure synchronization key signature verified during cross-platform data transfers.",
        validation: "Enforces a strict testing token sequence pattern string match: 'JUBI-TEST-1234-5678'.",
        status: "Active License Token"
      },
      {
        field: "stripeConnectId",
        type: "String (Merchant Gateway Identifier)",
        source: "Dashboard Developer Settings Form Input",
        destination: "Firestore products Document / Next.js Checkout API Stripe Payload Mapping",
        description: "The operational sub-merchant account path configuration string. Directs financial item purchase values directly to a user's connected bank account context map.",
        validation: "Must validate against a true live sub-merchant routing prefix string layout: 'acct_XXXXXXXXXXXXXXXX'.",
        status: "Active License Token"
      },
      {
        field: "registeredDomain",
        type: "String (Target URL)",
        source: "WP License Verification Ping",
        destination: "Firestore Validation Rules / Cross-Origin Origin Security Check",
        description: "Locks the capabilities key to an explicit site domain. Blocks external environments from draining computing RAM resources.",
        validation: "Strict host checking string match (e.g., 'koba-dev.local').",
        status: "Active License Token"
      },
      {
        field: "activatedAt",
        type: "Timestamp (ISO 8601)",
        source: "System Activation Handshake Complete",
        destination: "Firestore License Metrics Logs / Admin Workspace View",
        description: "Logs the exact generation moment when user verification credentials cleared security gates.",
        validation: "System tracking signature layout pattern: 'YYYY-MM-DDTHH:mm:ss.sssZ'.",
        status: "Active License Token"
      },
      {
        field: "audiobookCapability",
        type: "Boolean",
        source: "User Plan Selection Mapping",
        destination: "Firestore / Production Studio Panel / WP Native Audio Player Capability Grid",
        description: "Flag tracking whether the environment is authorized to boot up localized audiobook synthesis, streaming wave tracks, and player instances.",
        validation: "Must equal explicit true to run audio engine hooks.",
        status: "Active License Token"
      },
      {
        field: "ebookCapability",
        type: "Boolean",
        source: "User Plan Selection Mapping",
        destination: "Firestore / Author Workbench Editor / WP Native E-book Reader Engine Canvas",
        description: "Flag tracking whether the environment is authorized to compile chapter text vectors, handle layout schemas, and output custom typography canvases.",
        validation: "Must equal explicit true to unlock e-book formatting layers.",
        status: "Active License Token"
      }
    ],
    api_payloads: [
      {
        field: "Payload Object Variable: authorEmail",
        type: "String (User Verification Context Signature)",
        source: "Next.js Firebase Authentication App Session State",
        destination: "Agent Route Destructuring ➔ Firestore product Document Write Parameter",
        description: "Identifies the unique author entity owning the product. Dynamically extracted from user state rows instead of manual text inputs.",
        validation: "Required. Pulled straight from active context: auth.currentUser.email.",
        status: "API Core Field Element"
      },
      {
        field: "Payload Object Variable: bookTitle / title",
        type: "String (Publication Header Text Node)",
        source: "Catalog Panel Editing Component Workspace Modal Form",
        destination: "Agent Route Destructuring ➔ WordPress JSON Post Handler Body Sync",
        description: "Passes the text title directly to WordPress to create native 'koba_publication' titles and URL tracking slugs.",
        validation: "Required. Fails route execution if missing or undefined.",
        status: "API Core Field Element"
      },
      {
        field: "Payload Object Variable: price",
        type: "String (Decimal Data Node Format)",
        source: "Catalog Panel Editing Component Workspace Modal Form",
        destination: "Agent Route Destructuring ➔ Firestore Writer & WordPress Meta Fields",
        description: "Passes the price context to WordPress to create the pricing catalog structure on the storefront page layout.",
        validation: "Required. Value 0.00 is reformatted dynamically to bypass loose PHP sanitation locks.",
        status: "API Core Field Element"
      },
      {
        field: "Payload Object Variable: stripeConnectId",
        type: "String (Sub-Merchant Link Token)",
        source: "Catalog Panel Editing Component Workspace Modal Form",
        destination: "Agent Route Destructuring ➔ Next.js Checkout Router Context Mapping",
        description: "Provides the split-billing sub-account destination so storefront checkouts know where to route client purchase funds.",
        validation: "Optional. Required for multi-tenant payment splits.",
        status: "API Core Field Element"
      },
      {
        field: "Payload Object Variable: wpStudioKey",
        type: "String (X-KOBA-KEY Header Token)",
        source: "Catalog Panel Editing Component Workspace Modal Form",
        destination: "Agent Route Destructuring ➔ Fetch Request Request Headers Bridge Handshake",
        description: "The operational handshake verification passkey transmitted as an active header parameter to authorize the cross-platform post write.",
        validation: "Must match the secure local testing secret passkey pattern exactly.",
        status: "API Core Field Element"
      }
    ]
  };

  const currentDataset = dictionaryData[activeTab];
  const filteredData = currentDataset.filter(item =>
    item.field.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <div className="p-6 space-y-8 max-w-[95vw] mx-auto text-white font-sans min-h-[calc(100vh-4rem)]">
        
        {/* Header Console */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/40 pb-6">
          <div>
            <div className="flex items-center gap-2 text-emerald-400 mb-2">
              <Database className="w-6 h-6" />
              <span className="text-sm font-bold uppercase tracking-widest font-mono">Platform Infrastructure Management</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">System Data Dictionary Matrix</h1>
            <p className="text-base text-muted-foreground mt-1">Universal data field bindings, validation rule scopes, and asset flow mappings across KOBA-I platforms.</p>
          </div>
        </div>

        {/* Toolbar Section */}
        <div className="flex flex-col lg:flex-row gap-6 items-center justify-between bg-slate-900/40 p-5 rounded-2xl border border-border/40">
          <div className="flex flex-wrap gap-3 w-full lg:w-auto">
            <button
              onClick={() => { setActiveTab("products"); setSearchTerm(""); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === "products" ? "bg-emerald-500 text-slate-950 shadow-lg scale-[1.02]" : "bg-slate-950 text-slate-400 hover:text-white"}`}
            >
              <Layers className="w-4 h-4" /> products Collection
            </button>
            <button
              onClick={() => { setActiveTab("entitlements"); setSearchTerm(""); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === "entitlements" ? "bg-emerald-500 text-slate-950 shadow-lg scale-[1.02]" : "bg-slate-950 text-slate-400 hover:text-white"}`}
            >
              <Key className="w-4 h-4" /> entitlements Collection
            </button>
            <button
              onClick={() => { setActiveTab("licenses"); setSearchTerm(""); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === "licenses" ? "bg-emerald-500 text-slate-950 shadow-lg scale-[1.02]" : "bg-slate-950 text-slate-400 hover:text-white"}`}
            >
              <ShieldCheck className="w-4 h-4" /> plugin_licenses Mapping
            </button>
            <button
              onClick={() => { setActiveTab("api_payloads"); setSearchTerm(""); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === "api_payloads" ? "bg-emerald-500 text-slate-950 shadow-lg scale-[1.02]" : "bg-slate-950 text-slate-400 hover:text-white"}`}
            >
              <ArrowRightLeft className="w-4 h-4" /> API Payload Fields
            </button>
          </div>

          <div className="relative w-full lg:w-96">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search schema dictionary fields..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-border/60 rounded-xl pl-12 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 shadow-inner"
            />
          </div>
        </div>

        {/* Data Grid Component */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950 border-b border-border/70 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <th className="p-5 pl-8 min-w-[220px]">Field / Parameter Property</th>
                  <th className="p-5 min-w-[180px]">Data Primitive Type</th>
                  <th className="p-5 min-w-[320px]">Integration Workflow Pipeline Target Path</th>
                  <th className="p-5 min-w-[350px]">Operational Field Definition & Core Intent</th>
                  <th className="p-5 min-w-[320px]">Validation Schema Rules</th>
                  <th className="p-5 pr-8 text-right min-w-[140px]">System Tier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-sm font-medium">
                {filteredData.length > 0 ? (
                  filteredData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/40 transition-colors group">
                      <td className="p-5 pl-8 font-extrabold text-emerald-400 font-mono tracking-tight text-base group-hover:text-emerald-300">
                        {row.field}
                      </td>
                      <td className="p-5 text-slate-300 font-mono text-xs font-semibold">
                        {row.type}
                      </td>
                      <td className="p-5 text-slate-400">
                        <div className="flex flex-col space-y-1">
                          <span className="text-[11px] text-slate-500 font-extrabold uppercase tracking-widest font-mono">Flow Target</span>
                          <span className="text-slate-200 font-mono text-xs bg-slate-950/40 px-2 py-1 rounded border border-border/30 w-fit">{row.source} ➔ {row.destination}</span>
                        </div>
                      </td>
                      <td className="p-5 text-slate-300 leading-relaxed text-sm">
                        {row.description}
                      </td>
                      <td className="p-5">
                        <div className="bg-slate-950/80 p-4 rounded-xl border border-border/40 font-mono text-xs text-amber-400/90 leading-relaxed shadow-md">
                          {row.validation}
                        </div>
                      </td>
                      <td className="p-5 pr-8 text-right">
                        <span className={`text-[10px] font-black uppercase font-mono tracking-widest px-3 py-1 rounded-lg ${row.status.includes('Active') || row.status.includes('Token') || row.status.includes('Field') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="p-16 text-center text-base text-muted-foreground">
                      <HelpCircle className="w-10 h-10 mx-auto mb-3 text-slate-600 animate-pulse" />
                      No matching system parameters found for evaluation criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Constraint Summary Footer */}
        <div className="bg-slate-950/30 border border-border/60 rounded-2xl p-5 flex gap-4 items-start shadow-lg">
          <ShieldAlert className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <h4 className="text-sm font-bold uppercase tracking-wider text-white font-mono">Data Wrangler Architectural Constraints Summary</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every data property mapping defined inside this dictionary directly controls backend code flow behavior. Modifying schema patterns without updating verification interceptors or loose PHP checks will break transaction tracking, cause digital product handshakes to time out, or create data stream stalls inside your e-reader layouts.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}