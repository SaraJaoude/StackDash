import { API_ENDPOINTS } from "@/lib/api/endpoints";
import { apiGet } from "@/lib/api/route";

// GET /api/v1/workspaces: the workspace the key belongs to. See src/lib/api/route.ts and docs/api.md.
export const GET = apiGet(API_ENDPOINTS.workspaces);
