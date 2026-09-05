import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/authorization";

export default async function Home() {
  await requireAdmin("/today");
  redirect("/today");
}
