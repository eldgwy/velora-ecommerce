import { handleNotificationRetryRequest } from "@/modules/jobs/notification-retry";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleNotificationRetryRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleNotificationRetryRequest(request);
}
