import { API_ENDPOINTS } from "@/lib/api/endpoints";
import { apiGet } from "@/lib/api/route";

// GET /api/v1/usage-snapshots: usage and spend (usage:read). See src/lib/api/route.ts and docs/api.md.
export const GET = apiGet(API_ENDPOINTS.usageSnapshots);
