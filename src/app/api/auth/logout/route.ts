import { requireApiAdmin } from "@/lib/auth/authorization";
import { deleteAdminSession } from "@/lib/auth/session";
export async function POST(request: Request) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  await deleteAdminSession();
  return Response.json({ ok: true });
}
