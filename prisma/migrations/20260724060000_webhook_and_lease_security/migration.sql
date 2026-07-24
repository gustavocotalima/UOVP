DELETE FROM "UserOperationLease" lease
WHERE NOT EXISTS (
  SELECT 1
  FROM "User" app_user
  WHERE app_user."id" = lease."userId"
);

ALTER TABLE "UserOperationLease"
ADD CONSTRAINT "UserOperationLease_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM "PluggyWebhookEvent"
WHERE (
  "processedAt" IS NULL
  AND "createdAt" < CURRENT_TIMESTAMP - INTERVAL '24 hours'
) OR (
  "event" <> 'item/deleted'
  AND "processedAt" < CURRENT_TIMESTAMP - INTERVAL '30 days'
);

CREATE INDEX "PluggyWebhookEvent_userId_processedAt_createdAt_idx"
ON "PluggyWebhookEvent"("userId", "processedAt", "createdAt");
