export { auth as middleware } from "@/auth";

export const config = {
  matcher: ["/home/:path*", "/carteira/:path*", "/orcamento-domestico/:path*", "/ferramentas/:path*", "/faq/:path*"],
};
