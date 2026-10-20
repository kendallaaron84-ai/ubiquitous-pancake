void import('node:http').then(({ default: http }) => {

// Simulating the exact metadata payload Stripe would pass back from your bookshelf order
const mockStripePayload = JSON.stringify({
  id: "evt_test_mock_123XYZ",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_b1234567890",
      customer_details: {
        email: "mary.aaron@domain.com" // Testing a clean author/reader profile match
      },
      metadata: {
        koba_asset_id: "book_2_audiobook", // Matches your exact image dropdown element!
        origin_domain: "https://koba-dev.local" // Matches your local WordPress bookshelf environment
      },
      invoice: "in_123456789"
    }
  }
});

const options = {
  hostname: '127.0.0.1',
  port: 3001, // Make sure your Next.js local development server is running here
  path: '/api/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(mockStripePayload),
    // 🛡️ Passing a mock signature header. 
    // NOTE: In production, the real Stripe SDK validates this header securely.
    'stripe-signature': 't=123456789,v1=mock_signature_data'
  }
};

console.log("🚀 Initializing localized mock transaction broadcast loop...");

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(`\n============================`);
    console.log(`📡 SERVER RESPONSE STATUS: ${res.statusCode}`);
    console.log(`💬 RESPONSE PAYLOAD: ${data}`);
    console.log(`============================\n`);
    
    if (res.statusCode === 200) {
      console.log("✅ Mock process successfully delivered! Check your Firestore dashboard local explorer logs.");
    } else {
      console.log("❌ Execution stalled. Check your Next.js terminal execution log terminal window for tracing errors.");
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Connection Failure: ${e.message}. Is your development server active on port 3000?`);
});

req.write(mockStripePayload);
req.end();
});
