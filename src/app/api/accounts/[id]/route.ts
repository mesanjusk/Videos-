import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";

export const dynamic = "force-dynamic";
import { removeGoogleAccount, setAccountStatus, setDefaultAccount } from "@/modules/accounts/service";

const patchSchema = z.object({
  action: z.enum(["enable", "disable", "set-default"]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    switch (parsed.data.action) {
      case "enable":
        await setAccountStatus(userId, id, "active");
        break;
      case "disable":
        await setAccountStatus(userId, id, "disabled");
        break;
      case "set-default":
        await setDefaultAccount(userId, id);
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await removeGoogleAccount(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to remove account" }, { status: 500 });
  }
}
