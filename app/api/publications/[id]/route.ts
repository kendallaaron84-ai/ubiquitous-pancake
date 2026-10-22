import { retiredDashboardRouteResponse } from "@/core/security/retired-dashboard-route";

export const dynamic = "force-dynamic";

export async function GET() {
  return retiredDashboardRouteResponse();
}

export async function OPTIONS() {
  return retiredDashboardRouteResponse();
}
