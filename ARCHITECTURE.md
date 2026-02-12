# Architecture Overview

This document describes the structure of the OpenServ Agent SDK, how its components fit together, and how to navigate the codebase.

## What This SDK Does

The SDK lets you build AI agents that run on the [OpenServ platform](https://openserv.ai). An agent is an HTTP server that receives task and chat requests from the platform, uses OpenAI function-calling to decide which **capabilities** (tools) to invoke, and reports results back. The SDK handles authentication, request routing, LLM orchestration, file/task/chat management, and (in v2+) a WebSocket tunnel for local development.

## Repository Layout

```
src/
├── agent.ts        Core Agent class – HTTP server, capability registry, LLM orchestration
├── capability.ts   Capability wrapper – pairs a Zod schema with a run function
├── types.ts        Shared TypeScript types and Zod schemas for platform API objects
├── run.ts          run() helper – starts the agent and tunnel together
├── tunnel.ts       OpenServTunnel – WebSocket connection to the OpenServ proxy
├── mcp.ts          Model Context Protocol (MCP) client for external tool servers
├── logger.ts       Pino-based logger with pretty-print for development
└── index.ts        Public API re-exports

test/               Node.js built-in test runner (node --test) via tsx
examples/           Ready-to-run example agents (marketing, twitter, haiku, custom)
```

## Key Components

### Agent (`src/agent.ts`)

The central class. It:

1. **Starts an Express HTTP server** secured with Helmet, HPP, compression, and bcrypt-based auth token verification.
2. **Exposes a `POST /` endpoint** that the OpenServ platform (or tunnel) calls with `do-task` or `respond-chat-message` actions.
3. **Maintains a registry of capabilities** (tools). Each capability has a name, description, Zod input schema, and an optional `run` function.
4. **Orchestrates LLM calls** via two paths:
   - `process()` – uses the OpenAI SDK directly (requires an OpenAI API key) with iterative tool-calling.
   - `generate()` – delegates to the OpenServ runtime API, which handles LLM access on the platform side.
5. **Provides helper methods** for the platform API: `createTask`, `completeTask`, `uploadFile`, `deleteFile`, `sendChatMessage`, `requestHumanAssistance`, `getSecrets`, and more.

### Capability (`src/capability.ts`)

A thin wrapper that binds together:
- **name / description** – surfaced to the LLM as a function-calling tool.
- **inputSchema** – a Zod schema that validates and types the arguments the LLM supplies.
- **run** (optional) – the function executed when the LLM selects this tool. If omitted, the capability is "run-less" and the platform runtime handles execution.
- **outputSchema** (optional, run-less only) – describes the shape of the output.

### Tunnel (`src/tunnel.ts`)

Introduced in v2 for local development. Instead of deploying the agent to a public URL, the tunnel:
1. Opens a WebSocket to the OpenServ proxy.
2. Authenticates with the agent's API key.
3. Forwards incoming HTTP requests from the proxy to the local Express server and returns responses over the same WebSocket.

The tunnel is implemented as a state machine with explicit states (`idle` → `connecting` → `authenticating` → `connected` etc.) and automatic reconnection with exponential backoff.

### Run Helper (`src/run.ts`)

The `run(agent, options?)` function is the recommended entry point. It calls `agent.start()`, creates and starts the tunnel, and returns a `stop()` function for graceful shutdown (including signal handling for `SIGTERM`/`SIGINT`).

### MCP Client (`src/mcp.ts`)

Supports connecting to external tool servers via the [Model Context Protocol](https://modelcontextprotocol.io/). Three transports are supported: `stdio` (local process), `sse` (Server-Sent Events), and `http` (Streamable HTTP). When `autoRegisterTools` is enabled, tools discovered from the MCP server are automatically registered as agent capabilities.

### Types (`src/types.ts`)

Zod schemas and TypeScript types for all platform API request/response shapes: tasks, chat messages, files, secrets, integrations, human-assistance requests, and the action payloads the agent receives.

## Data Flow

```
OpenServ Platform
       │
       ▼
  ┌─────────┐   WebSocket (local dev)     ┌────────────┐
  │  Proxy   │◄────────────────────────────│   Tunnel    │
  └─────────┘                              └─────┬──────┘
       │                                         │ HTTP localhost
       │  HTTPS (deployed)                       ▼
       └──────────────────────────────►  ┌──────────────┐
                                         │  Agent HTTP  │
                                         │   Server     │
                                         └──────┬───────┘
                                                │
                                    ┌───────────┼───────────┐
                                    ▼           ▼           ▼
                               do-task   respond-chat   other routes
                                    │           │
                                    ▼           ▼
                               ┌─────────────────────┐
                               │   LLM Orchestration  │
                               │  (process / generate) │
                               └──────────┬──────────┘
                                          │
                                   tool calls
                                          │
                                          ▼
                                   ┌─────────────┐
                                   │ Capabilities │
                                   └─────────────┘
```

1. The platform sends an action (`do-task` or `respond-chat-message`) to the agent — either directly via HTTPS or through the WebSocket tunnel during local development.
2. The agent's Express server authenticates the request and dispatches it to `doTask()` or `respondToChat()`.
3. These handlers call `process()` (or `generate()`), which sends the conversation to the LLM with the registered capabilities as tools.
4. The LLM may request one or more tool calls. The agent executes the matching capability's `run` function, feeds the result back to the LLM, and repeats until the LLM produces a final text response.
5. The agent reports results back to the platform via its REST API helpers (e.g., `completeTask`, `sendChatMessage`).

## Development

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run dev          # watch mode
npm test             # run tests (node --test via tsx)
npm run lint         # eslint
npm run format       # prettier
npm run check-types  # tsc --noEmit
```

Tests use Node.js built-in test runner (`node:test`) with `tsx` for TypeScript transpilation. See `test/` for examples.

## Environment Variables

| Variable | Purpose |
|---|---|
| `OPENSERV_API_KEY` | Agent API key (required) |
| `OPENSERV_AUTH_TOKEN` | Auth token for request verification |
| `OPENAI_API_KEY` | OpenAI key for `process()` (optional) |
| `PORT` | HTTP server port (default: 7378) |
| `DISABLE_TUNNEL` | Set to `true` to skip tunnel in `run()` |
| `OPENSERV_API_URL` | Platform API base URL override |
| `OPENSERV_RUNTIME_URL` | Runtime API base URL override |
| `OPENSERV_PROXY_URL` | Tunnel proxy URL override |
