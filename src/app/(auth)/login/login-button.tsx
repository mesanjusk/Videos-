"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function LoginButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <Button className="w-full" size="lg" onClick={() => signIn("google", { callbackUrl })}>
      Continue with Google
    </Button>
  );
}
