import { publicConfig } from "../../../server/env";
import { errorResponse, json, resolveHuman } from "../../../server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await resolveHuman(request);
    return json(publicConfig());
  } catch (error) {
    return errorResponse(error);
  }
}
