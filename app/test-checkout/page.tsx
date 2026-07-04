"use client";

export const dynamic = 'force-dynamic';

export default function TestCheckoutPage() {
  const handleCheckout = async () => {
    try {
      // Replace this with an actual Price ID from your Stripe Test Dashboard (e.g., price_1H...)
      const TEST_PRICE_ID = "price_1Tg7dFAnSppkf2FmfREYrzem"; 

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          priceId: "price_1Tg7dFAnSppkf2FmfREYrzem", // Your actual test price ID from Stripe
          koba_asset_key: "bk_marya_duncan_audio_01", // 🔑 Updated name to match backend
          product_type: "Audiobook", // 🔑 Added: "Audiobook", "Plugin", or "Membership"
          stripeConnectId: "", // Leave empty for your own products, pass account ID for authors
          user_email: "kendall@example.com", // Pass the logged-in user's email
          origin_domain: window.location.hostname,
        }),
      });

      const data = await response.json();
      if (data.url) {
        // This redirects you away from localhost straight to Stripe's secure checkout page
        window.location.href = data.url;
      } else {
        console.error("Checkout initialization failed:", data.message);
      }
    } catch (err) {
      console.error("Error triggering checkout:", err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white">
      <h1 className="text-2xl font-bold mb-4">KOBA-I Payment Gateway Sandbox</h1>
      <button 
        onClick={handleCheckout}
        className="px-6 py-3 bg-indigo-600 rounded-lg font-medium hover:bg-indigo-500 transition"
      >
        Simulate Buying Audiobook
      </button>
    </div>
  );
}