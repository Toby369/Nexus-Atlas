"use client";

import { useRouter } from "next/navigation";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await supabaseAuthBrowser.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
    >
      Logout
    </button>
  );
}
