CREATE INDEX "FinanceTransaction_userId_source_deleted_id_idx"
  ON "FinanceTransaction"("userId", "source", "deleted", "id");

CREATE INDEX "McpOAuthToken_authCodeHash_idx"
  ON "McpOAuthToken"("authCodeHash");
