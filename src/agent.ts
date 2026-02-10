import axios, { type AxiosInstance } from 'axios'
import bcrypt from 'bcryptjs'
import compression from 'compression'
import express from 'express'
import type { AsyncRouterInstance } from 'express-async-router'
import { AsyncRouter } from 'express-async-router'
import helmet from 'helmet'
import hpp from 'hpp'
import { logger } from './logger'
import type http from 'node:http'
import type {
  GetFilesParams,
  GetSecretsParams,
  GetSecretValueParams,
  UploadFileParams,
  DeleteFileParams,
  MarkTaskAsErroredParams,
  CompleteTaskParams,
  SendChatMessageParams,
  GetTaskDetailParams,
  GetAgentsParams,
  GetTasksParams,
  CreateTaskParams,
  AddLogToTaskParams,
  RequestHumanAssistanceParams,
  UpdateTaskStatusParams,
  ProcessParams,
  IntegrationCallRequest,
  GetChatMessagesParams,
  AgentChatMessagesResponse,
  GetFilesResponse,
  GetSecretValueResponse,
  GetSecretsResponse,
  UploadFileResponse,
  DeleteFileResponse,
  GetTaskDetailResponse,
  GetAgentsResponse,
  GetTasksResponse,
  CreateTaskResponse,
  AddLogToTaskResponse,
  RequestHumanAssistanceResponse,
  UpdateTaskStatusResponse,
  MarkTaskAsErroredResponse,
  CompleteTaskResponse,
  SendChatMessageResponse,
  ActionSchema,
  DoTaskActionSchema,
  RespondChatMessageActionSchema
} from './types'
import { BadRequest } from 'http-errors'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletion
} from 'openai/resources/chat/completions'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { jsonSchemaToZod } from '@n8n/json-schema-to-zod'

import OpenAI from 'openai'
import { z } from 'zod'
import { Capability } from './capability'
import {
  McpError,
  MCPErrorCodes,
  type MCPServerConfig,
  type MCPToolDescriptor,
  MCPClient
} from './mcp'

const PLATFORM_URL = process.env.OPENSERV_API_URL || 'https://api.openserv.ai'
const RUNTIME_URL = process.env.OPENSERV_RUNTIME_URL || 'https://agents.openserv.ai'
const DEFAULT_PORT = Number.parseInt(process.env.PORT || '') || 7378

/** Default input schema for run-less capabilities that omit inputSchema */
const DEFAULT_INPUT_SCHEMA = z.object({ input: z.string() })

/** Runtime validation schema for capability configs */
const capabilityConfigSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.any().optional(),
    schema: z.any().optional(),
    run: z.any().optional(),
    outputSchema: z.any().optional()
  })
  .superRefine((data, ctx) => {
    if (data.inputSchema && data.schema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Cannot provide both "inputSchema" and "schema". Use "inputSchema" ("schema" is deprecated).'
      })
    }
    if (data.run && data.outputSchema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Cannot provide both "run" and "outputSchema". "outputSchema" is only for run-less capabilities.'
      })
    }
    if (!data.inputSchema && !data.schema && data.run) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Runnable capabilities require "inputSchema" (or deprecated "schema"). ' +
          'Only run-less capabilities can omit it.'
      })
    }
  })

/** Accept inputSchema (preferred) or schema (deprecated), never both */
type WithInputSchema<S extends z.ZodTypeAny> =
  | { inputSchema: S; schema?: never }
  | { schema: S; inputSchema?: never }

/** Optional inputSchema for run-less caps -- can omit entirely (uses default) */
type WithOptionalInputSchema<S extends z.ZodTypeAny> =
  | { inputSchema: S; schema?: never }
  | { schema: S; inputSchema?: never }
  | { inputSchema?: never; schema?: never }

/** Capability with a run function -- inputSchema required, outputSchema not allowed */
type RunnableCapabilityConfig<M extends string, S extends z.ZodTypeAny> = {
  name: string
  description: string
  run(
    this: Agent<M>,
    params: { args: z.infer<S>; action: ActionSchema },
    messages: ChatCompletionMessageParam[]
  ): string | Promise<string>
  outputSchema?: never
} & WithInputSchema<S>

/** Capability without run -- inputSchema optional, outputSchema optional */
type RunlessCapabilityConfig<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string
  description: string
  run?: never
  outputSchema?: z.ZodTypeAny
} & WithOptionalInputSchema<S>

/** Union of all valid capability forms */
export type CapabilityConfig<M extends string, S extends z.ZodTypeAny> =
  | RunnableCapabilityConfig<M, S>
  | RunlessCapabilityConfig<S>

/**
 * Configuration options for creating a new Agent instance.
 */
export interface AgentOptions<T extends string> {
  /**
   * The port number for the agent's HTTP server.
   * Defaults to 7378 if not specified.
   */
  port?: number

  /**
   * The OpenServ API key for authentication.
   * Can also be provided via OPENSERV_API_KEY environment variable.
   */
  apiKey?: string

  /**
   * The auth token for securing agent requests.
   * Can also be provided via OPENSERV_AUTH_TOKEN environment variable.
   * Generated by provision() and used to validate incoming requests.
   */
  authToken?: string

  /**
   * The system prompt that defines the agent's behavior and context.
   * Used as the initial system message in OpenAI chat completions.
   */
  systemPrompt: string

  /**
   * Optional OpenAI API key for direct LLM access via process().
   * NOT required for platform-deployed agents -- use generate() or run-less capabilities instead.
   * Can also be provided via OPENAI_API_KEY environment variable.
   */
  openaiApiKey?: string

  /**
   * Error handler function for all agent operations.
   * Defaults to logging the error if not provided.
   * @param error - The error that occurred
   * @param context - Additional context about where the error occurred
   */
  onError?: (error: Error, context?: Record<string, unknown>) => void

  /**
   * Configuration for MCP servers to connect to
   */
  mcpServers?: Record<T, MCPServerConfig>
}

export class Agent<M extends string = string> {
  /**
   * The Express application instance used to handle HTTP requests.
   * This is initialized in the constructor and used to set up middleware and routes.
   * @private
   */
  private app: express.Application

  /**
   * The HTTP server instance created from the Express application.
   * This is initialized when start() is called and used to listen for incoming requests.
   * @private
   */
  private server: http.Server | null = null

  /**
   * The Express router instance used to define API routes.
   * This handles routing for health checks, tool execution, and action handling.
   * @private
   */
  private router: AsyncRouterInstance

  /**
   * The port number the server will listen on.
   * Defaults to DEFAULT_PORT (7378) if not specified in options.
   * May change if the preferred port is unavailable.
   */
  public port: number

  /**
   * The system prompt used for OpenAI chat completions.
   * This defines the base behavior and context for the agent.
   * @protected
   */
  protected systemPrompt: string

  /**
   * Array of capabilities (tools) available to the agent.
   * Each capability is an instance of the Capability class with a name, description, inputSchema,
   * and optionally a run function and/or outputSchema.
   * @protected
   */
  protected tools: Array<Capability<M, z.ZodTypeAny>> = []

  /**
   * The OpenServ API key used for authentication.
   * Set via setCredentials() or resolved from options/env in start().
   */
  public apiKey?: string

  /**
   * The auth token used to validate incoming requests.
   * Set via setCredentials() or resolved from options/env in start().
   */
  public authToken?: string

  /**
   * Set credentials for this agent instance.
   * This is typically called by provision() to bind the agent to its platform credentials.
   *
   * @param credentials - The credentials to set
   * @param credentials.apiKey - The OpenServ API key for this agent
   * @param credentials.authToken - Optional auth token for securing agent requests
   *
   * @example
   * ```typescript
   * // Typically called by provision() automatically:
   * await provision({
   *   agent: { instance: myAgent, name: 'my-agent', ... }
   * })
   *
   * // Or manually:
   * agent.setCredentials({ apiKey: 'key', authToken: 'token' })
   * ```
   */
  setCredentials(credentials: { apiKey: string; authToken?: string }): void {
    this.apiKey = credentials.apiKey
    this.authToken = credentials.authToken
  }

  /**
   * Axios instance for making requests to the OpenServ API.
   * Initialized in start() after credentials are resolved.
   * @private
   */
  private apiClient!: AxiosInstance

  /**
   * Axios instance for making requests to the OpenServ Runtime API.
   * Initialized in start() after credentials are resolved.
   * @protected
   */
  protected runtimeClient!: AxiosInstance

  /**
   * OpenAI client instance.
   * Lazily initialized when needed using the provided API key.
   * @protected
   */
  protected _openai?: OpenAI

  /**
   * Map of MCP clients by server ID.
   * @private
   */
  public mcpClients: Record<M, MCPClient<M>> = {} as Record<M, MCPClient<M>>

  /**
   * Getter that converts the agent's tools into OpenAI function calling format.
   * Used when making chat completion requests to OpenAI.
   * @private
   * @returns Array of ChatCompletionTool objects
   */
  private get openAiTools(): ChatCompletionTool[] {
    return this.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.inputSchema)
      }
    })) as ChatCompletionTool[]
  }

  /**
   * Getter that provides access to the OpenAI client instance.
   * Lazily initializes the client with the API key from options or environment.
   * @private
   * @throws {Error} If no OpenAI API key is available
   * @returns {OpenAI} The OpenAI client instance
   */
  private get openai(): OpenAI {
    if (!this._openai) {
      const apiKey = this.options.openaiApiKey || process.env.OPENAI_API_KEY
      if (!apiKey) {
        throw new Error(
          'OpenAI API key is required for process(). Provide it via options or OPENAI_API_KEY env var. ' +
            'Alternatively, use generate() for runtime-delegated LLM calls, or run-less capabilities.'
        )
      }
      this._openai = new OpenAI({ apiKey })
    }
    return this._openai
  }

  /**
   * Creates a new Agent instance.
   * The agent is configured but not started until start() is called.
   *
   * @param {AgentOptions} options - Configuration options for the agent
   */
  constructor(private options: AgentOptions<M>) {
    this.app = express()
    this.router = AsyncRouter()
    this.port = this.options.port || DEFAULT_PORT
    this.systemPrompt = this.options.systemPrompt

    // Initialize MCP clients (no credentials needed)
    this.initializeMCPClients()

    // Define routes (they'll be attached to app in start())
    this.defineRoutes()
  }

  private initializeMCPClients() {
    if (this.options.mcpServers) {
      for (const serverId in this.options.mcpServers) {
        const serverConfig = this.options.mcpServers[serverId]

        if (!serverConfig) {
          logger.warn(`MCP server configuration for serverId "${serverId}" is undefined.`)
          continue
        }

        const client = new MCPClient(serverId, serverConfig)
        this.mcpClients[serverId] = client
      }
    }
  }

  /**
   * Adds a single capability (tool) to the agent.
   * Each capability must have a unique name. Capabilities can be:
   * - **Runnable**: has a `run` function and requires `inputSchema` (or deprecated `schema`)
   * - **Run-less**: no `run` function -- the runtime handles execution via LLM.
   *   `inputSchema` is optional (defaults to `{ input: z.string() }`), `outputSchema` is optional.
   *
   * @template S - The Zod schema type for the capability's parameters
   * @param capability - The capability configuration
   * @returns The agent instance for method chaining
   * @throws {Error} If a capability with the same name already exists
   * @throws {Error} If both `inputSchema` and `schema` are provided
   * @throws {Error} If both `run` and `outputSchema` are provided
   * @throws {Error} If a runnable capability omits `inputSchema`/`schema`
   */
  addCapability<S extends z.ZodTypeAny>(capability: CapabilityConfig<M, S>): this {
    const result = capabilityConfigSchema.safeParse(capability)
    if (!result.success) {
      throw new Error(result.error.issues[0]?.message ?? 'Invalid capability configuration')
    }

    const { name, description, run, outputSchema } = result.data
    const resolvedSchema = (result.data.inputSchema ??
      result.data.schema ??
      DEFAULT_INPUT_SCHEMA) as S

    if (this.tools.some(tool => tool.name === name)) {
      throw new Error(`Tool with name "${name}" already exists`)
    }

    this.tools.push(
      new Capability(
        name,
        description,
        resolvedSchema,
        typeof run === 'function' ? (run as Capability<M, S>['run']) : undefined,
        outputSchema
      ) as unknown as Capability<M, z.ZodTypeAny>
    )
    return this
  }

  /**
   * Adds multiple capabilities (tools) to the agent at once.
   * Each capability must have a unique name and not conflict with existing capabilities.
   * Each element can be runnable or run-less independently.
   *
   * @template T - Tuple of Zod schema types for the capabilities' parameters
   * @param capabilities - Array of capability configurations
   * @returns The agent instance for method chaining
   * @throws {Error} If any capability has a name that already exists
   */
  addCapabilities<T extends readonly [z.ZodTypeAny, ...z.ZodTypeAny[]]>(capabilities: {
    [K in keyof T]: CapabilityConfig<M, T[K]>
  }): this {
    for (const capability of capabilities) {
      this.addCapability(capability)
    }
    return this
  }

  /**
   * Gets files in a workspace.
   *
   * @param {GetFilesParams} params - Parameters for the file retrieval
   * @param {number} params.workspaceId - ID of the workspace to get files from
   * @returns {Promise<GetFilesResponse>} The files in the workspace
   */
  async getFiles(params: GetFilesParams) {
    const response = await this.apiClient.get<GetFilesResponse>(
      `/workspaces/${params.workspaceId}/files`
    )
    return response.data
  }

  /**
   * Get all secrets for an agent in a workspace.
   *
   * @param {GetSecretsParams} params - Parameters for the secrets retrieval
   * @returns {Promise<GetSecretsResponse>} List of agent secrets.
   */
  async getSecrets(params: GetSecretsParams) {
    const response = await this.apiClient.get<GetSecretsResponse>(
      `/workspaces/${params.workspaceId}/agent-secrets`
    )
    return response.data
  }

  /**
   * Get the value of a secret for an agent in a workspace
   *
   * @param {GetSecretValueParams} params - Parameters for the secret value retrieval
   * @returns {Promise<GetSecretValueResponse>} The value of the secret.
   */
  async getSecretValue(params: GetSecretValueParams) {
    const response = await this.apiClient.get<GetSecretValueResponse>(
      `/workspaces/${params.workspaceId}/agent-secrets/${params.secretId}/value`
    )
    return response.data
  }

  /**
   * Uploads a file to a workspace.
   *
   * @param {UploadFileParams} params - Parameters for the file upload
   * @param {number} params.workspaceId - ID of the workspace to upload to
   * @param {string} params.path - Path where the file should be stored
   * @param {number[]|number|null} [params.taskIds] - Optional task IDs to associate with the file
   * @param {boolean} [params.skipSummarizer] - Whether to skip file summarization
   * @param {Buffer|string} params.file - The file content to upload
   * @returns {Promise<UploadFileResponse>} The uploaded file details
   */
  async uploadFile(params: UploadFileParams) {
    const formData = new FormData()
    formData.append('path', params.path)
    if (params.taskIds) {
      formData.append('taskIds', JSON.stringify(params.taskIds))
    }
    if (params.skipSummarizer !== undefined) {
      formData.append('skipSummarizer', params.skipSummarizer.toString())
    }

    // Convert Buffer or string to Blob for FormData
    const fileBlob =
      params.file instanceof Buffer
        ? new Blob([params.file])
        : new Blob([params.file], { type: 'text/plain' })
    formData.append('file', fileBlob)

    const response = await this.apiClient.post<UploadFileResponse>(
      `/workspaces/${params.workspaceId}/file`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      }
    )
    return response.data
  }

  /**
   * Deletes a file from a workspace.
   *
   * @param {DeleteFileParams} params - Parameters for the file deletion
   * @param {number} params.workspaceId - ID of the workspace containing the file
   * @param {number} params.fileId - ID of the file to delete
   * @returns {Promise<DeleteFileResponse>} A success message confirming the file was deleted
   */
  async deleteFile(params: DeleteFileParams) {
    const response = await this.apiClient.delete<DeleteFileResponse>(
      `/workspaces/${params.workspaceId}/files/${params.fileId}`
    )
    return response.data
  }

  /**
   * Marks a task as errored.
   *
   * @param {MarkTaskAsErroredParams} params - Parameters for marking the task as errored
   * @param {number} params.workspaceId - ID of the workspace containing the task
   * @param {number} params.taskId - ID of the task to mark as errored
   * @param {string} params.error - Error message describing what went wrong
   * @returns {Promise<MarkTaskAsErroredResponse>} The updated task details
   */
  async markTaskAsErrored(params: MarkTaskAsErroredParams) {
    const response = await this.apiClient.post<MarkTaskAsErroredResponse>(
      `/workspaces/${params.workspaceId}/tasks/${params.taskId}/error`,
      {
        error: params.error
      }
    )
    return response.data
  }

  /**
   * Completes a task with the specified output.
   *
   * @param {CompleteTaskParams} params - Parameters for completing the task
   * @param {number} params.workspaceId - ID of the workspace containing the task
   * @param {number} params.taskId - ID of the task to complete
   * @param {string} params.output - Output or result of the completed task
   * @returns {Promise<CompleteTaskResponse>} The completed task details
   */
  async completeTask(params: CompleteTaskParams) {
    const response = await this.apiClient.put<CompleteTaskResponse>(
      `/workspaces/${params.workspaceId}/tasks/${params.taskId}/complete`,
      {
        output: params.output
      }
    )
    return response.data
  }

  /**
   * Sends a chat message from the agent.
   *
   * @param {SendChatMessageParams} params - Parameters for sending the chat message
   * @param {number} params.workspaceId - ID of the workspace where the chat is happening
   * @param {number} params.agentId - ID of the agent sending the message
   * @param {string} params.message - Content of the message to send
   * @returns {Promise<SendChatMessageResponse>} The sent message details
   */
  async sendChatMessage(params: SendChatMessageParams) {
    const response = await this.apiClient.post<SendChatMessageResponse>(
      `/workspaces/${params.workspaceId}/agent-chat/${params.agentId}/message`,
      {
        message: params.message
      }
    )
    return response.data
  }

  /**
   * Gets detailed information about a specific task.
   *
   * @param {GetTaskDetailParams} params - Parameters for getting task details
   * @param {number} params.workspaceId - ID of the workspace containing the task
   * @param {number} params.taskId - ID of the task to get details for
   * @returns {Promise<GetTaskDetailResponse>} The detailed task information
   */
  async getTaskDetail(params: GetTaskDetailParams) {
    const response = await this.apiClient.get<GetTaskDetailResponse>(
      `/workspaces/${params.workspaceId}/tasks/${params.taskId}/detail`
    )
    return response.data
  }

  /**
   * Gets a list of agents in a workspace.
   *
   * @param {GetAgentsParams} params - Parameters for getting agents
   * @param {number} params.workspaceId - ID of the workspace to get agents from
   * @returns {Promise<GetAgentsResponse>} List of agents in the workspace
   */
  async getAgents(params: GetAgentsParams) {
    const response = await this.apiClient.get<GetAgentsResponse>(
      `/workspaces/${params.workspaceId}/agents`
    )
    return response.data
  }

  /**
   * Gets a list of tasks in a workspace.
   *
   * @param {GetTasksParams} params - Parameters for getting tasks
   * @param {number} params.workspaceId - ID of the workspace to get tasks from
   * @returns {Promise<GetTasksResponse>} List of tasks in the workspace
   */
  async getTasks(params: GetTasksParams) {
    const response = await this.apiClient.get<GetTasksResponse>(
      `/workspaces/${params.workspaceId}/tasks`
    )
    return response.data
  }

  /**
   * Gets a list of tasks in a workspace.
   *
   * @param {GetChatMessagesParams} params - Parameters for getting chat messages
   * @param {number} params.workspaceId - ID of the workspace to get chat messages from
   * @param {number} params.agentId - ID of the agent to get chat messages from
   * @returns {Promise<AgentChatMessagesResponse>} List of chat messages
   */
  async getChatMessages(params: GetChatMessagesParams) {
    const response = await this.apiClient.get<AgentChatMessagesResponse>(
      `/workspaces/${params.workspaceId}/agent-chat/${params.agentId}/messages`
    )
    return response.data
  }

  /**
   * Creates a new task in a workspace.
   *
   * @param {CreateTaskParams} params - Parameters for creating the task
   * @param {number} params.workspaceId - ID of the workspace to create the task in
   * @param {number} params.assignee - ID of the agent to assign the task to
   * @param {string} params.description - Short description of the task
   * @param {string} params.body - Detailed body/content of the task
   * @param {string} params.input - Input data for the task
   * @param {string} params.expectedOutput - Expected output format or content
   * @param {number[]} params.dependencies - IDs of tasks that this task depends on
   * @returns {Promise<CreateTaskResponse>} The created task details
   */
  async createTask(params: CreateTaskParams) {
    const response = await this.apiClient.post<CreateTaskResponse>(
      `/workspaces/${params.workspaceId}/task`,
      {
        assignee: params.assignee,
        description: params.description,
        body: params.body,
        input: params.input,
        expectedOutput: params.expectedOutput,
        dependencies: params.dependencies
      }
    )
    return response.data
  }

  /**
   * Adds a log entry to a task.
   *
   * @param {AddLogToTaskParams} params - Parameters for adding the log
   * @param {number} params.workspaceId - ID of the workspace containing the task
   * @param {number} params.taskId - ID of the task to add the log to
   * @param {'info'|'warning'|'error'} params.severity - Severity level of the log
   * @param {'text'|'openai-message'} params.type - Type of log entry
   * @param {string|object} params.body - Content of the log entry
   * @returns {Promise<AddLogToTaskResponse>} The created log entry details
   */
  async addLogToTask(params: AddLogToTaskParams) {
    const response = await this.apiClient.post<AddLogToTaskResponse>(
      `/workspaces/${params.workspaceId}/tasks/${params.taskId}/log`,
      {
        severity: params.severity,
        type: params.type,
        body: params.body
      }
    )
    return response.data
  }

  /**
   * Requests human assistance for a task.
   *
   * @param {RequestHumanAssistanceParams} params - Parameters for requesting assistance
   * @param {number} params.workspaceId - ID of the workspace containing the task
   * @param {number} params.taskId - ID of the task needing assistance
   * @param {'text'|'project-manager-plan-review'} params.type - Type of assistance needed
   * @param {string|object} params.question - Question or request for the human
   * @param {object} [params.agentDump] - Optional agent state/context information
   * @returns {Promise<RequestHumanAssistanceResponse>} The created assistance request details
   */
  async requestHumanAssistance(params: RequestHumanAssistanceParams) {
    let question = params.question

    if (typeof question === 'string') {
      question = {
        type: 'text',
        question
      }
    } else {
      question = {
        type: 'json',
        ...question
      }
    }

    const response = await this.apiClient.post<RequestHumanAssistanceResponse>(
      `/workspaces/${params.workspaceId}/tasks/${params.taskId}/human-assistance`,
      {
        type: params.type,
        question,
        agentDump: params.agentDump
      }
    )
    return response.data
  }

  /**
   * Updates the status of a task.
   *
   * @param {UpdateTaskStatusParams} params - Parameters for updating the status
   * @param {number} params.workspaceId - ID of the workspace containing the task
   * @param {number} params.taskId - ID of the task to update
   * @param {TaskStatus} params.status - New status for the task
   * @returns {Promise<UpdateTaskStatusResponse>} The updated task details
   */
  async updateTaskStatus(params: UpdateTaskStatusParams) {
    const response = await this.apiClient.put<UpdateTaskStatusResponse>(
      `/workspaces/${params.workspaceId}/tasks/${params.taskId}/status`,
      {
        status: params.status
      }
    )
    return response.data
  }

  /**
   * Generate text via the OpenServ runtime.
   * Billed to the workspace/task in the action.
   * Use this inside custom `run` functions when you need LLM generation without your own OpenAI key.
   *
   * @param params.prompt - The prompt for the LLM
   * @param params.messages - Optional conversation history for context
   * @param params.action - Action context (required for billing)
   * @returns The generated text
   */
  async generate(params: {
    prompt: string
    messages?: ChatCompletionMessageParam[]
    action: ActionSchema
  }): Promise<string>
  /**
   * Generate a structured object via the OpenServ runtime.
   * Billed to the workspace/task in the action.
   *
   * @param params.prompt - The prompt for the LLM
   * @param params.messages - Optional conversation history for context
   * @param params.outputSchema - Zod schema for structured output
   * @param params.action - Action context (required for billing)
   * @returns The generated object, validated against the schema
   */
  async generate<T extends z.ZodTypeAny>(params: {
    prompt: string
    messages?: ChatCompletionMessageParam[]
    outputSchema: T
    action: ActionSchema
  }): Promise<z.infer<T>>
  async generate<T extends z.ZodTypeAny>(params: {
    prompt: string
    messages?: ChatCompletionMessageParam[]
    outputSchema?: T
    action: ActionSchema
  }): Promise<string | z.infer<T>> {
    const response = await this.runtimeClient.post('/generate', {
      prompt: params.prompt,
      ...(params.messages ? { messages: params.messages } : {}),
      ...(params.outputSchema ? { outputSchema: zodToJsonSchema(params.outputSchema) } : {}),
      action: params.action
    })

    if (params.outputSchema) {
      if (response.data.object === undefined || response.data.object === null) {
        throw new Error('Runtime returned no structured output for generate() with outputSchema')
      }
      return params.outputSchema.parse(response.data.object)
    }
    if (typeof response.data.text !== 'string') {
      throw new Error('Runtime returned no text for generate()')
    }
    return response.data.text
  }

  /**
   * Processes a conversation with OpenAI, handling tool calls iteratively until completion.
   *
   * @param {ProcessParams} params - Parameters for processing the conversation
   * @param {ChatCompletionMessageParam[]} params.messages - The conversation history
   * @returns {Promise<ChatCompletion>} The final response from OpenAI
   * @throws {Error} If no response is received from OpenAI or max iterations are reached
   */
  async process({ messages }: ProcessParams): Promise<ChatCompletion> {
    try {
      const apiKey = this.options.openaiApiKey || process.env.OPENAI_API_KEY
      if (!apiKey) {
        throw new Error(
          'OpenAI API key is required for process(). Provide it via options or OPENAI_API_KEY env var. ' +
            'Alternatively, use generate() for runtime-delegated LLM calls, or run-less capabilities.'
        )
      }

      const currentMessages = [...messages]

      if (!currentMessages.find(m => m.content === this.systemPrompt)) {
        currentMessages.unshift({
          role: 'system',
          content: this.systemPrompt
        })
      }

      let completion: ChatCompletion | null = null
      let iterationCount = 0
      const MAX_ITERATIONS = 10

      while (iterationCount < MAX_ITERATIONS) {
        completion = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: currentMessages,
          tools: this.tools.length ? this.openAiTools : undefined
        })

        if (!completion.choices?.length || !completion.choices[0]?.message) {
          throw new Error('No response from OpenAI')
        }

        const lastMessage = completion.choices[0].message

        // If there are no tool calls, we're done
        if (!lastMessage.tool_calls?.length) {
          return completion
        }

        // Process each tool call
        const toolResults = await Promise.all(
          lastMessage.tool_calls.map(async toolCall => {
            if (!toolCall.function) {
              throw new Error('Tool call function is missing')
            }
            const { name, arguments: args } = toolCall.function
            const parsedArgs = JSON.parse(args)

            try {
              // Find the tool in our tools array
              const tool = this.tools.find(t => t.name === name)
              if (!tool) {
                throw new Error(`Tool "${name}" not found`)
              }

              let result: string
              if (tool.run) {
                // Call the tool's run method with the parsed arguments and bind this
                result = await tool.run.bind(this)({ args: parsedArgs }, currentMessages)
              } else {
                // Shim: use OpenAI with conversation history + description for run-less capabilities
                const shimCompletion = await this.openai.chat.completions.create({
                  model: 'gpt-4o',
                  messages: [
                    ...currentMessages,
                    { role: 'system', content: tool.description },
                    { role: 'user', content: JSON.stringify(parsedArgs) }
                  ],
                  ...(tool.outputSchema
                    ? {
                        response_format: {
                          type: 'json_schema' as const,
                          json_schema: {
                            name: tool.name,
                            schema: zodToJsonSchema(tool.outputSchema),
                            strict: true
                          }
                        }
                      }
                    : {})
                })
                result = shimCompletion.choices[0]?.message?.content || ''
              }

              return {
                role: 'tool' as const,
                content: JSON.stringify(result),
                tool_call_id: toolCall.id
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
              this.handleError(error instanceof Error ? error : new Error(errorMessage), {
                toolCall,
                context: 'tool_execution'
              })
              return {
                role: 'tool' as const,
                content: JSON.stringify({ error: errorMessage }),
                tool_call_id: toolCall.id
              }
            }
          })
        )

        // Add the assistant's message and tool results to the conversation
        currentMessages.push(lastMessage, ...toolResults)
        iterationCount++
      }

      throw new Error('Max iterations reached without completion')
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        context: 'process'
      })
      throw error
    }
  }

  /**
   * Handle a task execution request
   * This method can be overridden by extending classes to customize task handling
   * @protected
   */
  protected async doTask(action: DoTaskActionSchema) {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.systemPrompt
      }
    ]

    if (action.task?.description) {
      messages.push({
        role: 'user',
        content: action.task.description
      })
    }

    const proxyTools = this.tools.filter(t => t.run)
    const runtimeTools = this.tools.filter(t => !t.run)

    try {
      await this.runtimeClient.post('/execute', {
        tools: proxyTools.map(convertProxyToolToJsonSchema),
        runtimeTools: runtimeTools.map(convertRuntimeToolToJsonSchema),
        messages,
        action
      })
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        action,
        context: 'do_task'
      })
    }
  }

  /**
   * Handle a chat message response request
   * This method can be overridden by extending classes to customize chat handling
   * @protected
   */
  protected async respondToChat(action: RespondChatMessageActionSchema) {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.systemPrompt
      }
    ]

    if (action.messages) {
      for (const msg of action.messages) {
        messages.push({
          role: msg.author === 'user' ? 'user' : 'assistant',
          content: msg.message
        })
      }
    }

    const proxyTools = this.tools.filter(t => t.run)
    const runtimeTools = this.tools.filter(t => !t.run)

    try {
      await this.runtimeClient.post('/chat', {
        tools: proxyTools.map(convertProxyToolToJsonSchema),
        runtimeTools: runtimeTools.map(convertRuntimeToolToJsonSchema),
        messages,
        action
      })
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        action,
        context: 'respond_to_chat'
      })
    }
  }

  /**
   * Handles execution of a specific tool/capability.
   *
   * The runtime calls this for both task execution (do-task) and chat (respond-chat-message),
   * always providing the action context in the request body.
   *
   * @param {Object} req - The request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.toolName - Name of the tool to execute
   * @param {Object} req.body - Request body
   * @param {z.infer<z.ZodTypeAny>} [req.body.args] - Arguments for the tool
   * @param {ActionSchema} req.body.action - Action context (required)
   * @param {ChatCompletionMessageParam[]} [req.body.messages] - Message history
   * @returns {Promise<{result: string}>} The result of the tool execution
   * @throws {BadRequest} If tool name is missing, tool is not found, or action is missing
   * @throws {Error} If tool execution fails
   */
  async handleToolRoute(req: {
    params: { toolName: string }
    body: {
      args?: z.infer<z.ZodTypeAny>
      action?: ActionSchema
      messages?: ChatCompletionMessageParam[]
    }
  }) {
    try {
      if (!('toolName' in req.params)) {
        throw new BadRequest('Tool name is required')
      }

      const tool = this.tools.find(t => t.name === req.params.toolName)
      if (!tool) {
        throw new BadRequest(`Tool "${req.params.toolName}" not found`)
      }

      if (!tool.run) {
        throw new BadRequest(
          `Tool "${req.params.toolName}" is a run-less capability handled by the runtime, not by this agent.`
        )
      }

      if (!req.body?.action) {
        throw new BadRequest('Action context is required for tool execution')
      }

      const args = await tool.inputSchema.parseAsync(req.body?.args)
      const messages = req.body.messages || []
      const result = await tool.run.call(this, { args, action: req.body.action }, messages)
      return { result }
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        request: req,
        context: 'handle_tool_route'
      })

      throw error
    }
  }

  /**
   * Handles the root route for task execution and chat message responses.
   *
   * @param {Object} req - The request object
   * @param {unknown} req.body - Request body to be parsed as an action
   * @returns {Promise<void>}
   * @throws {Error} If action type is invalid
   */
  async handleRootRoute(req: { body: unknown }) {
    try {
      const action = req.body as ActionSchema
      if (action.type === 'do-task') {
        this.doTask(action)
      } else if (action.type === 'respond-chat-message') {
        this.respondToChat(action)
      } else throw new Error('Invalid action type')
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        request: req,
        context: 'handle_root_route'
      })
    }
  }

  /**
   * Defines routes on the router (called in constructor).
   * Routes are attached to the app in start() after middleware is configured.
   * @private
   */
  private defineRoutes() {
    // Note: /health is registered on this.app in start() before auth middleware

    this.router.post('/', async (req: express.Request) => {
      return this.handleRootRoute({ body: req.body })
    })

    this.router.post('/tools/:toolName', async (req: express.Request) => {
      const { toolName } = req.params
      if (!toolName) {
        throw new BadRequest('Tool name is required')
      }
      return this.handleToolRoute({
        params: { toolName },
        body: req.body
      })
    })
  }

  /**
   * Starts the agent's HTTP server.
   * If the preferred port is unavailable, it will find an open port.
   *
   * @returns {Promise<void>} Resolves when the server has started
   * @throws {Error} If server fails to start or if API key is missing
   */
  async start(): Promise<void> {
    // Resolve credentials from options or environment if not already set via setCredentials()
    if (!this.apiKey) {
      this.apiKey = this.options.apiKey || process.env.OPENSERV_API_KEY
    }
    if (!this.authToken) {
      this.authToken = this.options.authToken || process.env.OPENSERV_AUTH_TOKEN
    }

    // Validate API key
    if (!this.apiKey) {
      throw new Error(
        'OpenServ API key is required. Please provide it in options, set OPENSERV_API_KEY environment variable, or call provision() first.'
      )
    }

    // Initialize API clients
    this.apiClient = axios.create({
      baseURL: PLATFORM_URL,
      headers: {
        'Content-Type': 'application/json',
        'x-openserv-key': this.apiKey
      }
    })

    this.runtimeClient = axios.create({
      baseURL: `${RUNTIME_URL}/runtime`,
      headers: {
        'Content-Type': 'application/json',
        'x-openserv-key': this.apiKey
      }
    })

    // Set up middleware
    this.app.use(express.json({ limit: '10mb' }))
    this.app.use(express.urlencoded({ extended: false }))
    this.app.use(hpp())
    this.app.use(helmet())
    this.app.use(compression())

    // Health check — before auth so the platform health cron can reach it
    this.app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'ok', uptime: process.uptime() })
    })

    // Auth middleware
    if (this.authToken) {
      this.app.use(async (req, res, next) => {
        const tokenHash = req.headers['x-openserv-auth-token']

        if (!tokenHash || typeof tokenHash !== 'string') {
          res.status(401).json({ error: 'Unauthorized' })
          return
        }

        const isTokenValid = await bcrypt.compare(this.authToken as string, tokenHash)

        if (!isTokenValid) {
          res.status(401).json({ error: 'Unauthorized' })
          return
        }

        next()
      })
    } else {
      logger.warn('OPENSERV_AUTH_TOKEN is not set. All requests will be allowed.')
    }

    // Attach routes to app (routes are defined in constructor)
    this.app.use('/', this.router)

    const preferredPort = this.port

    // Try the preferred port first, fallback to an available port if it fails
    await new Promise<void>((resolve, reject) => {
      const tryListen = (port: number, isRetry: boolean) => {
        const server = this.app.listen(port)

        const onListening = () => {
          // Remove the startup handlers once listening succeeds
          server.removeListener('error', errorHandler)
          server.removeListener('listening', onListening)
          if (isRetry) {
            const address = server.address()
            if (address && typeof address === 'object') {
              this.port = address.port
              logger.info(`Port ${preferredPort} was unavailable, using port ${this.port} instead`)
            }
          } else {
            logger.info(`Agent server started on port ${this.port}`)
          }
          this.server = server
          resolve()
        }

        const errorHandler = (err: NodeJS.ErrnoException) => {
          // Clean up the failed server before handling the error
          server.removeListener('error', errorHandler)
          server.removeListener('listening', onListening)

          // Close the failed server to release resources
          server.close()

          if (err.code === 'EADDRINUSE' && !isRetry) {
            logger.warn(`Port ${this.port} is in use, finding an available port...`)
            // Let the OS assign an available port
            tryListen(0, true)
          } else {
            reject(err)
          }
        }

        server.on('listening', onListening)
        server.on('error', errorHandler)
      }

      tryListen(this.port, false)
    })

    const connectionPromises = Object.values<MCPClient<M>>(this.mcpClients).map(client =>
      client.connect()
    )
    const results = await Promise.allSettled(connectionPromises)
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error({ error: result.reason }, 'Failed to connect MCP client')
      }
    }

    try {
      for (const key in this.mcpClients) {
        const mcpClient = this.mcpClients[key]
        const serverId = mcpClient.serverId
        const serverConfig = this.options.mcpServers?.[serverId]

        if (!serverConfig?.autoRegisterTools) {
          continue
        }

        const tools = mcpClient.getTools()
        if (tools.length === 0) {
          logger.info(
            `MCP server "${serverId}" connected, but no tools found/returned to auto-register.`
          )
          continue
        }

        this.addMCPToolsAsCapabilities(serverId, tools)
        logger.info(`Auto-registered ${tools.length} tools for MCP server "${serverId}".`)
      }
    } catch (mcpError) {
      logger.error({ error: mcpError }, 'Error during MCP tools registration')
    }
  }

  /**
   * Stops the agent's HTTP server.
   *
   * @returns {Promise<void>} Resolves when the server has stopped
   */
  async stop() {
    if (!this.server) return

    return new Promise<void>(resolve => {
      this.server?.close(() => resolve())
    })
  }

  /**
   * Default error handler that logs the error
   * @private
   */
  private handleError(error: Error, context?: Record<string, unknown>) {
    const handler =
      this.options.onError ??
      ((err, ctx) => logger.error({ error: err, ...ctx }, 'Error in agent operation'))
    handler(error, context)
  }

  /**
   * Calls an integration endpoint through the OpenServ platform.
   * This method allows agents to interact with external services and APIs that are integrated with OpenServ.
   *
   * @param {IntegrationCallRequest} integration - The integration request parameters
   * @param {number} integration.workspaceId - ID of the workspace where the integration is configured
   * @param {string} integration.integrationId - ID of the integration to call
   * @param {Object} integration.details - Details of the integration call
   * @param {string} integration.details.endpoint - The endpoint to call on the integration
   * @param {string} integration.details.method - The HTTP method to use (GET, POST, etc.)
   * @param {Object} [integration.details.data] - Optional data payload for the request
   * @returns {Promise<any>} The response from the integration endpoint
   * @throws {Error} If the integration call fails
   */
  async callIntegration(integration: IntegrationCallRequest) {
    const response = await this.apiClient.post(
      `/workspaces/${integration.workspaceId}/integration/${integration.integrationId}/proxy`,
      integration.details
    )

    return response.data
  }

  /**
   * Registers a list of MCP tool descriptors as capabilities on the agent.
   * Each tool is wrapped in a function that calls `executeMCPTool`.
   * The capability name is prefixed with `mcp_<serverId>_`.
   *
   * @param serverId - The ID of the MCP server these tools belong to.
   * @param tools - An array of {@link MCPToolDescriptor} objects to register.
   * @private
   */
  private addMCPToolsAsCapabilities(serverId: M, tools: MCPToolDescriptor[]): void {
    for (const tool of tools) {
      const capabilityName = `mcp_${serverId}_${tool.name}`
      const inputSchema = tool.inputSchema ?? { type: 'object', properties: {} }

      // Register the capability
      this.addCapability({
        name: capabilityName,
        description: tool.description || `Tool from MCP server ${serverId}`,
        inputSchema: jsonSchemaToZod(inputSchema),
        async run({ args }) {
          const mcpClient = this.mcpClients[serverId]
          if (!mcpClient) {
            throw new McpError(
              MCPErrorCodes.INVALID_PARAMS,
              `Attempted to run tool for unknown MCP serverId: ${serverId}`
            )
          }
          try {
            const result = await mcpClient.executeTool(tool.name, args)

            // Extract content based on result format
            if (result && typeof result === 'object' && 'content' in result) {
              const content = result.content
              return typeof content === 'string' ? content : JSON.stringify(content)
            }
            return JSON.stringify(result)
          } catch (callError) {
            logger.error(`Error calling MCP tool "${capabilityName}":`, callError)
            throw new McpError(
              MCPErrorCodes.INTERNAL_ERROR,
              `Failed to execute MCP tool ${tool.name}: ${callError instanceof Error ? callError.message : String(callError)}`
            )
          }
        }
      })
    }
  }
}

function convertProxyToolToJsonSchema<M extends string>(tool: Capability<M, z.ZodTypeAny>) {
  return {
    name: tool.name,
    description: tool.description,
    schema: zodToJsonSchema(tool.inputSchema)
  }
}

function convertRuntimeToolToJsonSchema<M extends string>(tool: Capability<M, z.ZodTypeAny>) {
  return {
    name: tool.name,
    description: tool.description,
    schema: zodToJsonSchema(tool.inputSchema),
    ...(tool.outputSchema ? { outputSchema: zodToJsonSchema(tool.outputSchema) } : {})
  }
}
