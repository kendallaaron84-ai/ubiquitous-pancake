import { NextResponse } from "next/server";

export function retiredDashboardRouteResponse() {
  return NextResponse.json(
    {
      success: false,
      code: "LEGACY_DASHBOARD_ROUTE_RETIRED",
      error: "This legacy Dashboard route is no longer available.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
