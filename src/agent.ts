import axios, { type AxiosInstance } from 'axios'
import { logger } from './logger'
import WebSocket from 'ws'
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
  SendChatMessageResponse
} from './types'
import type { doTaskActionSchema, respondChatMessageActionSchema } from './types'
import { actionSchema } from './types'
import { BadRequest } from 'http-errors'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletion
} from 'openai/resources/chat/completions'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { jsonSchemaToZod } from '@n8n/json-schema-to-zod'

import OpenAI from 'openai'
import type { z } from 'zod'
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
const DEFAULT_PROXY_URL = process.env.OPENSERV_PROXY_URL || 'https://agents-proxy.openserv.ai'
const MAX_RECONNECTION_ATTEMPTS = 10
const FORCE_TUNNEL = process.env.FORCE_TUNNEL === 'true'

/**
 * Configuration options for creating a new Agent instance.
 */
export interface AgentOptions<T extends string> {
  /**
   * The OpenServ API key for authentication.
   * Can also be provided via OPENSERV_API_KEY environment variable.
   */
  apiKey?: string

  /**
   * The system prompt that defines the agent's behavior and context.
   * Used as the initial system message in OpenAI chat completions.
   */
  systemPrompt: string

  /**
   * The OpenAI API key for chat completions.
   * Can also be provided via OPENAI_API_KEY environment variable.
   * Required when using the process() method.
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

export class Agent<M extends string> {
  /**
   * WebSocket connection to the OpenServ proxy
   * @private
   */
  private ws: WebSocket | null = null

  /**
   * Tunnel ID for the WebSocket connection
   * @private
   */
  private tunnelId: string | null = null

  /**
   * Public URL provided by the proxy
   * @private
   */
  private publicUrl: string | null = null

  /**
   * Number of reconnection attempts
   * @private
   */
  private reconnectAttempts: number = 0

  /**
   * Whether the agent is currently connecting
   * @private
   */
  private isConnecting: boolean = false

  /**
   * Whether the agent should attempt to reconnect
   * @private
   */
  private shouldReconnect: boolean = true

  /**
   * Timestamp when disconnection occurred
   * @private
   */
  private disconnectedAt: number | null = null

  /**
   * The system prompt used for OpenAI chat completions.
   * This defines the base behavior and context for the agent.
   * @protected
   */
  protected systemPrompt: string

  /**
   * Array of capabilities (tools) available to the agent.
   * Each capability is an instance of the Capability class with a name, description, schema, and run function.
   * @protected
   */
  protected tools: Array<Capability<M, z.ZodTypeAny>> = []

  /**
   * The OpenServ API key used for authentication.
   * Can be provided in options or via OPENSERV_API_KEY environment variable.
   * @private
   */
  private apiKey: string

  /**
   * Axios instance for making requests to the OpenServ API.
   * Pre-configured with base URL and authentication headers.
   * @private
   */
  private apiClient: AxiosInstance

  /**
   * Axios instance for making requests to the OpenServ Runtime API.
   * Pre-configured with base URL and authentication headers.
   * @protected
   */
  protected runtimeClient: AxiosInstance

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
        parameters: zodToJsonSchema(tool.schema)
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
          'OpenAI API key is required for process(). Please provide it in options or set OPENAI_API_KEY environment variable.'
        )
      }
      this._openai = new OpenAI({ apiKey })
    }
    return this._openai
  }

  /**
   * Creates a new Agent instance.
   * Initializes API clients with appropriate authentication.
   *
   * @param {AgentOptions} options - Configuration options for the agent
   * @throws {Error} If OpenServ API key is not provided in options or environment
   */
  constructor(private options: AgentOptions<M>) {
    this.systemPrompt = this.options.systemPrompt
    this.apiKey = this.options.apiKey || process.env.OPENSERV_API_KEY || ''

    if (!this.apiKey) {
      throw new Error(
        'OpenServ API key is required. Please provide it in options or set OPENSERV_API_KEY environment variable.'
      )
    }

    // Initialize API client
    this.apiClient = axios.create({
      baseURL: PLATFORM_URL,
      headers: {
        'Content-Type': 'application/json',
        'x-openserv-key': this.apiKey
      }
    })

    // Initialize runtime client
    this.runtimeClient = axios.create({
      baseURL: `${RUNTIME_URL}/runtime`,
      headers: {
        'Content-Type': 'application/json',
        'x-openserv-key': this.apiKey
      }
    })

    this.initializeMCPClients()
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
   * Each capability must have a unique name and defines a function that can be called via the API.
   *
   * @template S - The Zod schema type for the capability's parameters
   * @param {Object} capability - The capability configuration
   * @param {string} capability.name - Unique name for the capability
   * @param {string} capability.description - Description of what the capability does
   * @param {S} capability.schema - Zod schema defining the capability's parameters
   * @param {Function} capability.run - Function that implements the capability's behavior
   * @param {Object} capability.run.params - Parameters for the run function
   * @param {z.infer<S>} capability.run.params.args - Validated arguments matching the schema
   * @param {z.infer<typeof actionSchema>} [capability.run.params.action] - Optional action context
   * @param {ChatCompletionMessageParam[]} capability.run.messages - Chat message history
   * @returns {this} The agent instance for method chaining
   * @throws {Error} If a capability with the same name already exists
   */
  addCapability<S extends z.ZodTypeAny>({
    name,
    description,
    schema,
    run
  }: {
    name: string
    description: string
    schema: S
    run(
      this: Agent<M>,
      params: { args: z.infer<S>; action?: z.infer<typeof actionSchema> },
      messages: ChatCompletionMessageParam[]
    ): string | Promise<string>
  }): this {
    // Validate tool name uniqueness
    if (this.tools.some(tool => tool.name === name)) {
      throw new Error(`Tool with name "${name}" already exists`)
    }
    // Type assertion through unknown for safe conversion between compatible generic types
    this.tools.push(
      new Capability(name, description, schema, run) as unknown as Capability<M, z.ZodTypeAny>
    )
    return this
  }

  /**
   * Adds multiple capabilities (tools) to the agent at once.
   * Each capability must have a unique name and not conflict with existing capabilities.
   *
   * @template T - Tuple of Zod schema types for the capabilities' parameters
   * @param {Object} capabilities - Array of capability configurations
   * @param {string} capabilities[].name - Unique name for each capability
   * @param {string} capabilities[].description - Description of what each capability does
   * @param {T[number]} capabilities[].schema - Zod schema defining each capability's parameters
   * @param {Function} capabilities[].run - Function that implements each capability's behavior
   * @returns {this} The agent instance for method chaining
   * @throws {Error} If any capability has a name that already exists
   */
  addCapabilities<T extends readonly [z.ZodTypeAny, ...z.ZodTypeAny[]]>(capabilities: {
    [K in keyof T]: {
      name: string
      description: string
      schema: T[K]
      run(
        this: Agent<M>,
        params: { args: z.infer<T[K]>; action?: z.infer<typeof actionSchema> },
        messages: ChatCompletionMessageParam[]
      ): string | Promise<string>
    }
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
          'OpenAI API key is required for process(). Please provide it in options or set OPENAI_API_KEY environment variable.'
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

              // Call the tool's run method with the parsed arguments and bind this
              const result = await tool.run.bind(this)({ args: parsedArgs }, currentMessages)
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
  protected async doTask(action: z.infer<typeof doTaskActionSchema>) {
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

    try {
      await this.runtimeClient.post('/execute', {
        tools: this.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          schema: zodToJsonSchema(tool.schema)
        })),
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
  protected async respondToChat(action: z.infer<typeof respondChatMessageActionSchema>) {
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

    try {
      await this.runtimeClient.post('/chat', {
        tools: this.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          schema: zodToJsonSchema(tool.schema)
        })),
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
   * Starts the agent by connecting to the OpenServ proxy via WebSocket.
   *
   * @returns {Promise<void>} Resolves when the connection is established
   * @throws {Error} If connection fails
   */
  async start(): Promise<void> {
    // Connect MCP clients first
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

    // Connect to the WebSocket proxy
    await this.connectToProxy()
  }

  /**
   * Connects to the OpenServ proxy via WebSocket
   * @private
   */
  private async connectToProxy(): Promise<void> {
    if (this.isConnecting) return
    this.isConnecting = true

    try {
      if (!this.apiKey) {
        throw new Error('API key is required. Set OPENSERV_API_KEY environment variable.')
      }

      logger.info(`Connecting to OpenServ proxy...`)
      if (this.tunnelId) {
        logger.info(`Reconnecting with tunnel ID: ${this.tunnelId}`)
      }

      if (FORCE_TUNNEL) {
        logger.info('Force tunnel override: enabled')
      }

      // Convert HTTP URL to WebSocket URL
      const wsUrl = DEFAULT_PROXY_URL.replace(/^http/, 'ws') + '/ws'

      // Add registration data in WebSocket headers
      const wsOptions: { headers: Record<string, string> } = {
        headers: {
          'User-Agent': 'OpenServ-Agent/1.0.0',
          'X-Api-Key': this.apiKey
        }
      }

      // Add tunnel ID if we have one (for reconnection)
      if (this.tunnelId) {
        wsOptions.headers['X-Tunnel-ID'] = this.tunnelId
      }

      // Add force tunnel flag if set
      if (FORCE_TUNNEL) {
        wsOptions.headers['X-Force-Tunnel'] = 'true'
      }

      this.ws = new WebSocket(wsUrl, wsOptions)

      this.ws.on('open', () => {
        this.reconnectAttempts = 0 // Reset on successful connection
        this.isConnecting = false
        logger.info('Connected to OpenServ proxy')
      })

      // Handle ping from server
      this.ws.on('ping', (data: Buffer) => {
        this.ws?.pong(data)
      })

      this.ws.on('message', async (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString())
          await this.handleWebSocketMessage(message)
        } catch (error) {
          logger.error({ error }, 'Error processing WebSocket message')
        }
      })

      this.ws.on('close', async (code: number, reason: Buffer) => {
        this.isConnecting = false
        logger.info(`WebSocket disconnected: ${code} ${reason.toString()}`)

        // Record disconnect time for reconnection timing
        if (this.shouldReconnect && this.reconnectAttempts < MAX_RECONNECTION_ATTEMPTS) {
          if (!this.disconnectedAt) {
            this.disconnectedAt = Date.now()
          }
          await this.attemptReconnection()
        } else if (this.reconnectAttempts >= MAX_RECONNECTION_ATTEMPTS) {
          logger.error('Max reconnection attempts reached. Giving up.')
          process.exit(1)
        }
      })

      this.ws.on('error', (error: Error) => {
        this.isConnecting = false
        logger.error({ error }, 'WebSocket connection error')

        // Record disconnect time for reconnection timing if we're going to reconnect
        if (this.shouldReconnect && this.reconnectAttempts < MAX_RECONNECTION_ATTEMPTS) {
          if (!this.disconnectedAt) {
            this.disconnectedAt = Date.now()
          }
        }

        if (this.shouldReconnect && this.reconnectAttempts < MAX_RECONNECTION_ATTEMPTS) {
          this.attemptReconnection()
        }
      })
    } catch (error) {
      this.isConnecting = false
      logger.error({ error }, 'Error connecting to proxy')

      if (this.shouldReconnect && this.reconnectAttempts < MAX_RECONNECTION_ATTEMPTS) {
        if (!this.disconnectedAt) {
          this.disconnectedAt = Date.now()
        }
        await this.attemptReconnection()
      }
    }
  }

  /**
   * Handles WebSocket messages from the proxy
   * @private
   */
  private async handleWebSocketMessage(message: any): Promise<void> {
    if (message.type === 'error') {
      // Handle tunnel creation errors
      if (message.error === 'TUNNEL_EXISTS') {
        logger.error(`Tunnel error: ${message.message}`)

        if (message.existingTunnel) {
          logger.info('Existing tunnel details:', {
            tunnelId: message.existingTunnel.tunnelId,
            publicUrl: message.existingTunnel.publicUrl,
            localPort: message.existingTunnel.localPort
          })
        }

        logger.info(
          'To force overwrite the existing tunnel, set FORCE_TUNNEL=true environment variable'
        )
        this.shouldReconnect = false
        process.exit(1)
      } else {
        logger.error(`Tunnel error: ${message.message}`)
        this.shouldReconnect = false
        process.exit(1)
      }
    } else if (message.type === 'registered') {
      // Handle tunnel registration confirmation
      const tunnelData = message.data
      this.tunnelId = tunnelData.tunnelId
      this.publicUrl = tunnelData.publicUrl

      if (tunnelData.reconnected) {
        // Calculate reconnection time if we have a disconnect timestamp
        if (this.disconnectedAt) {
          const reconnectDuration = Date.now() - this.disconnectedAt
          logger.info(`Tunnel reconnected! (${(reconnectDuration / 1000).toFixed(2)}s)`)
          this.disconnectedAt = null // Reset the timer
        } else {
          logger.info('Tunnel reconnected!')
        }
      } else {
        logger.info('Tunnel ready!')
      }
      logger.info(`Public URL: ${tunnelData.publicUrl}`)
    } else if (message.type === 'request') {
      await this.handleProxyRequest(message.data)
    }
  }

  /**
   * Handles incoming requests from the proxy
   * @private
   */
  private async handleProxyRequest(requestData: any): Promise<void> {
    const { method, path, body, id } = requestData

    try {
      let response: { status: number; headers: Record<string, string>; body: string }

      // Route the request based on method and path
      if (method === 'GET' && path === '/health') {
        response = {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'ok', uptime: process.uptime() })
        }
      } else if (method === 'POST' && path === '/') {
        // Handle root route (task execution and chat responses)
        try {
          const parsedBody = typeof body === 'string' ? JSON.parse(body) : body
          const action = await actionSchema.parseAsync(parsedBody)
          if (action.type === 'do-task') {
            await this.doTask(action)
          } else if (action.type === 'respond-chat-message') {
            await this.respondToChat(action)
          } else {
            throw new Error('Invalid action type')
          }
          response = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ success: true })
          }
        } catch (error) {
          response = {
            status: 400,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              error: 'Bad Request',
              message: error instanceof Error ? error.message : 'Unknown error'
            })
          }
        }
      } else if (method === 'POST' && path.startsWith('/tools/')) {
        // Handle tool execution
        const toolName = path.split('/tools/')[1]
        try {
          const parsedBody = typeof body === 'string' ? JSON.parse(body) : body

          if (!toolName) {
            throw new BadRequest('Tool name is required')
          }

          const tool = this.tools.find(t => t.name === toolName)
          if (!tool) {
            throw new BadRequest(`Tool "${toolName}" not found`)
          }

          const args = await tool.schema.parseAsync(parsedBody?.args)
          const messages = parsedBody.messages || []
          const result = await tool.run.call(this, { args, action: parsedBody.action }, messages)

          response = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ result })
          }
        } catch (error) {
          response = {
            status: error instanceof BadRequest ? 400 : 500,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              error: error instanceof BadRequest ? 'Bad Request' : 'Internal Server Error',
              message: error instanceof Error ? error.message : 'Unknown error'
            })
          }
        }
      } else {
        // Handle unknown routes
        response = {
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Not Found', message: `${method} ${path} not found` })
        }
      }

      // Send response back through WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'response',
            data: {
              id,
              status: response.status,
              headers: response.headers,
              body: response.body
            }
          })
        )
      }
    } catch (error) {
      logger.error({ error }, 'Error handling proxy request')

      // Send error response
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'response',
            data: {
              id,
              status: 502,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                error: 'Bad Gateway',
                message: error instanceof Error ? error.message : 'Unknown error'
              })
            }
          })
        )
      }
    }
  }

  /**
   * Attempts to reconnect to the proxy with exponential backoff
   * @private
   */
  private async attemptReconnection(): Promise<void> {
    this.reconnectAttempts++

    // First attempt is instant, then exponential backoff starts
    const delay =
      this.reconnectAttempts === 1
        ? 0
        : Math.min(1000 * Math.pow(2, this.reconnectAttempts - 2), 30000) // Max 30 seconds

    if (delay === 0) {
      logger.info(
        `Reconnection attempt ${this.reconnectAttempts}/${MAX_RECONNECTION_ATTEMPTS} (instant)...`
      )
    } else {
      logger.info(
        `Reconnection attempt ${this.reconnectAttempts}/${MAX_RECONNECTION_ATTEMPTS} in ${delay / 1000}s...`
      )
    }

    await this.sleep(delay)
    await this.connectToProxy()
  }

  /**
   * Sleep utility function
   * @private
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Gets the public URL assigned by the proxy (available after connection)
   * @returns {string | null} The public URL or null if not connected
   */
  getPublicUrl(): string | null {
    return this.publicUrl
  }

  /**
   * Gets the tunnel ID assigned by the proxy (available after connection)
   * @returns {string | null} The tunnel ID or null if not connected
   */
  getTunnelId(): string | null {
    return this.tunnelId
  }

  /**
   * Stops the agent by closing the WebSocket connection.
   *
   * @returns {Promise<void>} Resolves when the connection is closed
   */
  async stop(): Promise<void> {
    this.shouldReconnect = false
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close()
    }

    // Close MCP clients
    for (const client of Object.values<MCPClient<M>>(this.mcpClients)) {
      try {
        const protocolClient = client.getClient()
        if (protocolClient && typeof protocolClient.disconnect === 'function') {
          await protocolClient.disconnect()
        }
      } catch (error) {
        logger.error({ error }, 'Error disconnecting MCP client')
      }
    }
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
        schema: jsonSchemaToZod(inputSchema),
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
