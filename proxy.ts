export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
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
    "/faq/:path*",
  ],
};
