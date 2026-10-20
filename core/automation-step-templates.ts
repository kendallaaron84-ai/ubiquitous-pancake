export interface AutomationStepTemplate {
  id: string;
  name: string;
  category: "onboarding" | "stripe" | "wordpress";
  description: string;
}

export const AUTOMATION_STEP_TEMPLATES: readonly AutomationStepTemplate[] = [
  { id: "step_1", name: "Step 1: User Onboarding Flow", category: "onboarding", description: "Verifies user signup form and active session cookie generation." },
  { id: "step_2", name: "Step 2: Ingest Manuscript Document", category: "onboarding", description: "Uploads raw text manuscript to secure CDN asset directory." },
  { id: "step_3", name: "Step 3: Parse Sections & Structural Hierarchy", category: "onboarding", description: "Processes manuscript sections, titles, and table of contents." },
  { id: "step_4", name: "Step 4: Generate Firebase Audiobook", category: "onboarding", description: "Invokes KOBA-I Studio synthesize audiobook audio tracks." },
  { id: "step_5", name: "Step 5: Publish Product Metadata (CPT)", category: "onboarding", description: "Publishes product details to custom WordPress post type endpoint." },
  { id: "step_6", name: "Step 6: Generate Cover Art Graphics", category: "onboarding", description: "Triggers generative image pipelines to create high-resolution book cover art." },
  { id: "step_7", name: "Step 7: Verify WordPress CPT Sync Pipeline", category: "onboarding", description: "Validates canonical asset keys against the WordPress publication endpoint." },
  { id: "step_8", name: "Step 8: Verify Bookshelf License Activation", category: "onboarding", description: "Asserts that the public catalog handles active plugin licenses." },
  { id: "step_9", name: "Step 9: Verify Stripe Connect Merchant Authorization", category: "onboarding", description: "Validates merchant authentication against active platform profiles." },
  { id: "step_10", name: "Step 10: Verify Dynamic Entitlement Provisioning", category: "onboarding", description: "Asserts that a successful payment creates the required access rights." },
  { id: "step_11", name: "Step 11: Deploy Stripe Webhook Listeners", category: "stripe", description: "Validates payment signal handling and entitlement provisioning." },
  { id: "step_12", name: "Step 12: [WIP] Verify Author Modular Purchasing (A-La-Carte)", category: "stripe", description: "Tests author tier upgrades and billing intervals." },
  { id: "step_13", name: "Step 13: [WIP] Verify Author Subscription Packages (Recurring)", category: "stripe", description: "Validates recurring license provisioning." },
  { id: "step_14", name: "Step 14: Test Credit Card Checkout Flows", category: "stripe", description: "Validates sandbox checkout behavior." },
  { id: "step_15", name: "Step 15: Verify Dynamic Entitlement Authorization", category: "stripe", description: "Validates successful purchases against the entitlement matrix." },
  { id: "step_16", name: "Step 16: Audit Platform Revenue Splitting", category: "stripe", description: "Validates Stripe Connect payout and platform-fee behavior." },
  { id: "step_17", name: "Step 17: Verify Secure Gated Media Streaming", category: "stripe", description: "Validates temporary protected-media access." },
  { id: "step_18", name: "Step 18: Verify Universal Page Builder Rendering Engine", category: "wordpress", description: "Audits shortcode rendering across supported WordPress builders." },
  { id: "step_19", name: "Step 19: Verify Dynamic Client Runtime Metadata Injection", category: "wordpress", description: "Validates runtime author, asset, and pricing metadata." },
  { id: "step_20", name: "Step 20: [BACKLOG] Validate Audiobook RSS Feed Generation", category: "wordpress", description: "Future secure audiobook feed validation." },
  { id: "step_21", name: "Step 21: Verify Cloud Media Storage Hotlink Prevention", category: "wordpress", description: "Validates protected media against unsigned direct access." },
  { id: "step_22", name: "Step 22: Validate Author Workbench Layout Fidelity", category: "wordpress", description: "Validates formatted text and illustrations in the Reader." },
  { id: "step_22b", name: "Step 22b: [BACKLOG] Enforce EPUB Standard Validation Checks", category: "wordpress", description: "Future EPUB package conformance validation." },
  { id: "step_23", name: "Step 23: Complete Bookshelf Styling & Interactivity Audit", category: "wordpress", description: "Validates bookshelf styling and interactions on supported sites." },
];
