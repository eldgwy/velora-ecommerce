import { handleCartRecoveryRequest } from "@/modules/jobs/cart-recovery";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleCartRecoveryRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCartRecoveryRequest(request);
}
