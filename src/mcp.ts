import { z } from 'zod'
import { logger } from './logger'

// biome-ignore lint/suspicious/noExplicitAny: Using any as the actual type is dynamically imported from the MCP SDK.
export type ProtocolClient = any
// biome-ignore lint/suspicious/noExplicitAny: Using any as the actual type is dynamically imported from the MCP SDK.
export type MCPTransport = any

/**
 * Raw descriptor for a tool as returned by an MCP server's listTools method.
 */
export type MCPToolDescriptor = {
  /** The name of the tool. */
  name: string
  /** An optional description of what the tool does. */
  description?: string
  /** An optional JSON schema defining the input parameters for the tool. */
  inputSchema?: Record<string, unknown>
}

// Zod Schemas for MCP Server Configuration
/** Zod schema for validating MCP server configurations using 'stdio' transport. */
export const mcpServerConfigStdioSchema = z.object({
  /** Specifies the transport type as 'stdio'. */
  transport: z.literal('stdio'),
  /** The command to execute to start the server. */
  command: z.string().min(1, 'Command cannot be empty'),
  /** Arguments to pass to the command. */
  args: z.array(z.string()),
  /** Optional environment variables for the command. */
  env: z.record(z.string()).optional(),
  /** Whether to automatically discover tools and register them as capabilities upon successful connection. Defaults to false. */
  autoRegisterTools: z.boolean().optional()
})

/** Zod schema for validating MCP server configurations using 'sse' transport. */
export const mcpServerConfigSseSchema = z.object({
  /** Specifies the transport type as 'sse'. */
  transport: z.literal('sse'),
  /** The URL of the MCP server's SSE endpoint. */
  url: z.string().url('Invalid URL format for SSE transport'),
  /** Whether to automatically discover tools and register them as capabilities upon successful connection. Defaults to false. */
  autoRegisterTools: z.boolean().optional()
})

/** Zod schema for validating MCP server configurations using 'http' (Streamable HTTP) transport. */
export const mcpServerConfigHttpSchema = z.object({
  /** Specifies the transport type as 'http'. */
  transport: z.literal('http'),
  /** The URL of the MCP server's HTTP endpoint. */
  url: z.string().url('Invalid URL format for HTTP transport'),
  /** Whether to automatically discover tools and register them as capabilities upon successful connection. Defaults to false. */
  autoRegisterTools: z.boolean().optional()
})

/**
 * Discriminated union Zod schema for validating MCP server configurations.
 * It differentiates based on the 'transport' property.
 */
export const mcpServerConfigSchema = z.discriminatedUnion('transport', [
  mcpServerConfigStdioSchema,
  mcpServerConfigSseSchema,
  mcpServerConfigHttpSchema
])

// Inferred TypeScript types from Zod schemas
/** Configuration for a single MCP server, covering all transport types. */
export type MCPServerConfig = z.infer<typeof mcpServerConfigSchema>
/** Configuration for an MCP server using 'stdio' (standard input/output) transport. */
export type MCPServerConfigStdio = z.infer<typeof mcpServerConfigStdioSchema>
/** Configuration for an MCP server using 'sse' (Server-Sent Events) transport. */
export type MCPServerConfigSse = z.infer<typeof mcpServerConfigSseSchema>
/** Configuration for an MCP server using 'http' (Streamable HTTP) transport. */
export type MCPServerConfigHttp = z.infer<typeof mcpServerConfigHttpSchema>

/** Dynamically imports the MCP Client class from the MCP SDK. */
export async function importClient() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  return Client
}

/** Dynamically imports the MCP StdioClientTransport class from the MCP SDK. */
export async function importStdioTransport() {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  return StdioClientTransport
}

/** Dynamically imports the MCP SSEClientTransport class from the MCP SDK. */
export async function importSSETransport() {
  const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
  return SSEClientTransport
}

/** Dynamically imports the MCP StreamableHTTPClientTransport class from the MCP SDK. */
export async function importHttpTransport() {
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  )
  return StreamableHTTPClientTransport
}

/**
 * Creates a new MCP client instance.
 * @param name - The name of the client.
 * @param version - The version of the client.
 * @returns A promise that resolves to an MCPClient instance.
 */
export async function createClient(name: string, version: string): Promise<ProtocolClient> {
  const Client = await importClient()
  return new Client({ name, version })
}

/**
 * Creates a new MCP transport layer for stdio communication.
 * @param options - Configuration options for the stdio transport.
 * @param options.command - The command to execute to start the server.
 * @param options.args - Arguments to pass to the command.
 * @param options.env - Optional environment variables for the command.
 * @returns A promise that resolves to an MCPTransport instance for stdio.
 */
export async function createStdioTransport(options: {
  command: string
  args: string[]
  env?: Record<string, string> | undefined
}): Promise<MCPTransport> {
  const StdioClientTransport = await importStdioTransport()
  return new StdioClientTransport(options)
}

/**
 * Creates a new MCP transport layer for Server-Sent Events (SSE) communication.
 * @param url - The URL of the MCP server's SSE endpoint.
 * @returns A promise that resolves to an MCPTransport instance for SSE.
 */
export async function createSSETransport(url: URL): Promise<MCPTransport> {
  const SSEClientTransport = await importSSETransport()
  return new SSEClientTransport(url)
}

/**
 * Creates a new MCP transport layer for Streamable HTTP communication.
 * @param url - The URL of the MCP server's HTTP endpoint.
 * @returns A promise that resolves to an MCPTransport instance for HTTP.
 */
export async function createHttpTransport(url: URL): Promise<MCPTransport> {
  const StreamableHTTPClientTransport = await importHttpTransport()
  return new StreamableHTTPClientTransport(url)
}

/**
 * MCP server class for handling MCP protocol communication.
 * Manages tool registration and execution.
 */
export class MCPClient<T extends string> {
  /** The unique identifier for this MCP server configuration. */
  public serverId: T
  /** Array storing discovered tool descriptors after connection. */
  private tools: MCPToolDescriptor[] = []
  /** The configuration object for this specific MCP server. */
  private config: MCPServerConfig
  /** The underlying client instance from the @modelcontextprotocol/sdk. */
  private client: ProtocolClient

  /**
   * Creates a new MCPClient instance.
   * Validates the provided configuration.
   *
   * @param serverId - The unique identifier for this MCP server configuration.
   * @param config - The configuration object for the server.
   * @throws {McpError} If the configuration is invalid.
   */
  constructor(serverId: T, config: MCPServerConfig) {
    this.config = config
    this.serverId = serverId

    if (!this.validateMCPServerConfig(this.serverId, this.config)) {
      throw new McpError(
        MCPErrorCodes.INVALID_PARAMS,
        `Invalid configuration for MCP server "${this.serverId}". Check logs for details.`
      )
    }
  }

  /**
   * Connects to the MCP server using the configured transport.
   * Establishes a connection based on the transport type (stdio or sse)
   * and initializes the client with the appropriate transport layer.
   * @returns {Promise<void>} A promise that resolves when the connection is established and tools (if any) are fetched.
   * @throws {McpError} If connection fails or transport type is invalid
   */
  async connect(): Promise<void> {
    let transport: MCPTransport | undefined
    const transportType = this.config.transport

    try {
      logger.info(`Connecting to MCP server "${this.serverId}" using ${transportType}...`)

      if (this.config.transport === 'sse') {
        transport = await createSSETransport(new URL(this.config.url))
      } else if (this.config.transport === 'http') {
        transport = await createHttpTransport(new URL(this.config.url))
      } else if (this.config.transport === 'stdio') {
        transport = await createStdioTransport({
          command: this.config.command,
          args: this.config.args,
          env: this.config.env
        })
      }

      if (!transport) {
        throw new McpError(
          MCPErrorCodes.INTERNAL_ERROR,
          `Transport could not be initialized for "${this.serverId}" with type ${transportType}.`
        )
      }

      this.client = await createClient(`agent-${this.serverId}`, '1.0.0')
      this.client.connect(transport)

      // Wait for the server to be ready
      await new Promise(resolve => setTimeout(resolve, 5000))

      logger.info(`Successfully connected to MCP server "${this.serverId}"`)
      this.tools = await this.fetchMCPToolDescriptors()
    } catch (error) {
      if (this.client) this.client.disconnect()

      if (error instanceof McpError) {
        throw error
      }
      throw new McpError(
        MCPErrorCodes.INTERNAL_ERROR,
        `Failed to connect to MCP server "${this.serverId}" using ${transportType}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Fetches the list of tool descriptors from the connected MCP server.
   * Should only be called after a successful connection.
   *
   * @returns {Promise<MCPToolDescriptor[]>} A promise resolving to an array of tool descriptors.
   * @private
   * @throws {McpError} If the client is not connected or the server response is invalid.
   */
  private async fetchMCPToolDescriptors(): Promise<MCPToolDescriptor[]> {
    if (!this.client) {
      throw new McpError(
        MCPErrorCodes.INVALID_PARAMS,
        `Cannot fetch tool descriptors: No active client found for server "${this.serverId}". Ensure connection was successful.`
      )
    }

    // Request tool list
    const response = await this.client.listTools()

    if (!response || !Array.isArray(response.tools)) {
      logger.warn(`No tools returned from "${this.serverId}"`)
      return []
    }

    const tools = response.tools as MCPToolDescriptor[]
    logger.debug(
      `MCP: server "${this.serverId}" discovered tools: [${tools.map(t => t.name).join(', ')}]`
    )

    return tools
  }

  /**
   * Validates the MCP server configuration using the Zod schema.
   *
   * @param serverName - The name/ID of the server (for logging).
   * @param config - The configuration object to validate.
   * @returns `true` if valid, `false` otherwise.
   * @private
   */
  private validateMCPServerConfig(serverName: string, config: MCPServerConfig): boolean {
    const result = mcpServerConfigSchema.safeParse(config)

    if (!result.success) {
      logger.error(
        `Invalid configuration for MCP server "${serverName}". Errors: `,
        result.error.flatten()
      )
      return false
    }

    return true
  }

  /**
   * Executes a specific tool on the connected MCP server.
   *
   * @param toolName - The name of the tool to execute.
   * @param parameters - The parameters to pass to the tool.
   * @returns A promise resolving with the result from the tool execution.
   * @throws {McpError} If the client is not connected or the tool execution fails.
   */
  async executeTool(toolName: string, parameters: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new McpError(MCPErrorCodes.CONNECTION_CLOSED, 'Client not connected or initialized')
    }

    logger.debug({ args: parameters }, `MCP: calling "${toolName}" on server "${this.serverId}"`)

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: parameters
      })

      logger.debug({ result }, `MCP: "${toolName}" on server "${this.serverId}" returned`)

      return result
    } catch (e) {
      logger.error(
        { error: e instanceof Error ? e.message : String(e) },
        `MCP: "${toolName}" on server "${this.serverId}" failed`
      )
      throw new McpError(
        MCPErrorCodes.INTERNAL_ERROR,
        `Failed to execute tool ${toolName} on server ${this.serverId}: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Gets the list of discovered tool descriptors for this server.
   * Tools are fetched during the `connect` method.
   *
   * @returns {MCPToolDescriptor[]} An array of discovered tool descriptors.
   */
  getTools(): MCPToolDescriptor[] {
    return this.tools
  }

  /**
   * Gets the underlying protocol client instance.
   * Primarily for internal use or specific low-level interactions.
   *
   * @returns {ProtocolClient} The raw protocol client instance.
   */
  getClient(): ProtocolClient {
    return this.client
  }
}

/**
 * Standard MCP error class with error codes following JSON-RPC spec.
 * Useful for creating and identifying MCP-specific errors.
 */
export class McpError extends Error {
  /** The JSON-RPC error code. */
  code: number
  /** Optional additional data related to the error. */
  data?: unknown

  /**
   * Constructs an McpError.
   * @param code - The JSON-RPC error code (see MCPErrorCodes).
   * @param message - A human-readable description of the error.
   * @param data - Optional additional data related to the error.
   */
  constructor(code: number, message: string, data?: unknown) {
    super(`MCP error ${code}: ${message}`)
    this.name = 'McpError'
    this.code = code
    this.data = data
  }
}

/**
 * MCP error codes following the JSON-RPC specification.
 * Provides a standardized set of codes for common MCP errors.
 */
export const MCPErrorCodes = {
  /** Connection was closed. */
  CONNECTION_CLOSED: -32000,
  /** Request timed out. */
  REQUEST_TIMEOUT: -32001,
  /** Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text. */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object. */
  INVALID_REQUEST: -32600,
  /** The method does not exist / is not available. */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s). */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error. */
  INTERNAL_ERROR: -32603
}
