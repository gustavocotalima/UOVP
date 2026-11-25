import { type NextMiddleware, NextResponse } from "next/server";
import { auth } from "@/auth";

// NextAuth supports exporting auth directly as middleware, but its types omit
// the direct middleware invocation overload.
const authProxy = auth as unknown as NextMiddleware;

export const proxy: NextMiddleware = (request, event) => {
  if (request.nextUrl.pathname === "/") {
    // The root only redirects. Reject POSTs before Next tries to decode an action.
    if (request.method === "POST") {
      return new NextResponse(null, {
        status: 405,
        headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
      });
    }
    return NextResponse.next();
  }
  return authProxy(request, event);
};

export const config = {
  matcher: [
    "/",
    "/home/:path*",
    "/orcamento-domestico/:path*",
    "/metas/:path*",
    "/contas/:path*",
    "/faturas/:path*",
    "/transacoes/:path*",
    "/tags/:path*",
    "/perfil/:path*",
    "/carteira/:path*",
    "/open-finance/:path*",
    "/ferramentas/:path*",
  ],
};
