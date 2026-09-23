import { NextResponse } from "next/server";
import { getActiveUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });

  const leases = await prisma.userOperationLease.findMany({
    where: {
      userId: user.id,
      operation: { in: ["pluggy-bootstrap", "pluggy-sync"] },
      lockedUntil: { gt: new Date() },
    },
    select: { operation: true },
  });

  return NextResponse.json({
    active: leases.length > 0,
    automatic: leases.some((lease) => lease.operation === "pluggy-bootstrap"),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
