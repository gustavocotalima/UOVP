import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("The HTTPS test proxy is CI-only.");
createServer({ key: readFileSync(process.argv[2]), cert: readFileSync(process.argv[3]) }, (incoming, outgoing) => {
  const upstream = request({
    hostname: "127.0.0.1", port: 3000, method: incoming.method, path: incoming.url,
    headers: {
      ...incoming.headers,
      "x-forwarded-proto": "https",
      "x-forwarded-host": incoming.headers.host,
      "x-forwarded-for": "127.0.0.1",
    },
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on("error", () => { outgoing.writeHead(502); outgoing.end("Test app unavailable"); });
  incoming.on("aborted", () => upstream.destroy());
  incoming.pipe(upstream);
}).listen(8443, "127.0.0.1", () => console.log("CI HTTPS proxy listening on port 8443."));
