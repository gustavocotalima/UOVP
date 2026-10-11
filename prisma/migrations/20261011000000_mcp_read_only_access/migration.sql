ALTER TABLE "User" ADD COLUMN "mcpEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "McpOAuthClient" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "redirectUris" TEXT[] NOT NULL,
  "metadataUrl" TEXT, "ownerId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpOAuthClient_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "McpOAuthGrant" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL, "resource" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "McpOAuthGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "McpOAuthGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "McpOAuthCode" (
  "codeHash" TEXT NOT NULL PRIMARY KEY, "grantId" TEXT NOT NULL, "redirectUri" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3),
  CONSTRAINT "McpOAuthCode_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "McpOAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "McpOAuthToken" (
  "id" TEXT NOT NULL PRIMARY KEY, "grantId" TEXT NOT NULL, "scopes" TEXT[] NOT NULL,
  "familyId" TEXT NOT NULL, "authCodeHash" TEXT, "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshHash" TEXT, "refreshExpiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpOAuthToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "McpOAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "McpOAuthToken_authCodeHash_fkey" FOREIGN KEY ("authCodeHash") REFERENCES "McpOAuthCode"("codeHash") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "McpAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
  "tool" TEXT NOT NULL, "outcome" TEXT NOT NULL, "durationMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "McpOAuthClient_ownerId_idx" ON "McpOAuthClient"("ownerId");
CREATE INDEX "McpOAuthGrant_userId_revokedAt_idx" ON "McpOAuthGrant"("userId", "revokedAt");
CREATE INDEX "McpOAuthGrant_clientId_idx" ON "McpOAuthGrant"("clientId");
CREATE INDEX "McpOAuthCode_expiresAt_idx" ON "McpOAuthCode"("expiresAt");
CREATE UNIQUE INDEX "McpOAuthToken_refreshHash_key" ON "McpOAuthToken"("refreshHash");
CREATE INDEX "McpOAuthToken_grantId_idx" ON "McpOAuthToken"("grantId");
CREATE INDEX "McpOAuthToken_familyId_idx" ON "McpOAuthToken"("familyId");
CREATE INDEX "McpOAuthToken_accessExpiresAt_idx" ON "McpOAuthToken"("accessExpiresAt");
CREATE INDEX "McpAuditEvent_userId_createdAt_idx" ON "McpAuditEvent"("userId", "createdAt");
CREATE INDEX "McpAuditEvent_createdAt_idx" ON "McpAuditEvent"("createdAt");
