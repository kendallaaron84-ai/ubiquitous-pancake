const RETIRED_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Studio-Key",
  "Cache-Control": "no-store",
};

export function retiredReaderAuthOptions() {
  return new Response(null, { status: 204, headers: RETIRED_HEADERS });
}

export function retiredReaderAuthResponse() {
  return Response.json(
    {
      success: false,
      code: "LEGACY_READER_AUTH_RETIRED",
      error: "This reader authorization method is no longer supported.",
    },
    { status: 410, headers: RETIRED_HEADERS }
  );
}
