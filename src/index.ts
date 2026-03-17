import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { registerTools } from "./tools.js";

const PORT = parseInt(process.env.PORT || "3457");

const app = express();
app.use(express.json());

// Create MCP server
const server = new McpServer({
  name: "gmail-mcp",
  version: "1.0.0",
});

registerTools(server);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "gmail-mcp", version: "1.0.0" });
});

// MCP HTTP transport
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`gmail-mcp listening on port ${PORT}`);
});