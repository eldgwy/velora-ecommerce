import { handleBannerSyncRequest } from "@/modules/jobs/sync-banner-statuses";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleBannerSyncRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleBannerSyncRequest(request);
}
