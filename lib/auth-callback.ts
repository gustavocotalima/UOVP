export function safeLoginCallback(value: unknown) {
  if (typeof value !== "string" || value.length > 8192 || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/home";
  // Only the local MCP consent flow needs to survive login. Do not introduce a
  // generic open redirect into authentication.
  const url = new URL(value, "http://localhost");
  return url.pathname === "/mcp/authorize" ? `${url.pathname}${url.search}` : "/home";
}
