import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkLoginRateLimit, clearAuthRateLimit } from "@/lib/auth-security";
import { requireSecureSecret, validateProductionSecurityConfig } from "@/lib/security-config";

const DUMMY_PASSWORD_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.4YHfnn8vR7eV/XvD7iI8LQ0lVXm6M6a";
validateProductionSecurityConfig();
const authSecret = requireSecureSecret("AUTH_SECRET");

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128).refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    "A senha excede o limite seguro.",
  ),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        if (!await checkLoginRateLimit(parsed.data.email, request.headers)) return null;
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true, email: true, name: true, image: true, passwordHash: true },
        });
        const valid = await compare(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!valid || !user?.passwordHash) return null;
        await clearAuthRateLimit("login-account", parsed.data.email);
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        const stored = await prisma.user.findUnique({
          where: { id: user.id },
          select: { sessionVersion: true },
        });
        token.userId = user.id;
        token.sessionVersion = stored?.sessionVersion ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = String(token.userId);
        session.user.sessionVersion = Number(token.sessionVersion ?? 0);
      }
      return session;
    },
    authorized({ auth: session }) {
      return Boolean(session?.user?.id);
    },
  },
});
