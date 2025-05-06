import axios, { type AxiosInstance } from 'axios'
import bcrypt from 'bcryptjs'
import compression from 'compression'
import express, { type Handler } from 'express'
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
  AgentChatMessagesResponse
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
import OpenAI from 'openai'
import type { z } from 'zod'
import { Capability } from './capability'

const PLATFORM_URL = process.env.OPENSERV_API_URL || 'https://api.openserv.ai'
const RUNTIME_URL = process.env.OPENSERV_RUNTIME_URL || 'https://agents.openserv.ai'
const DEFAULT_PORT = Number.parseInt(process.env.PORT || '') || 7378
const AUTH_TOKEN = process.env.OPENSERV_AUTH_TOKEN

/**
 * Configuration options for creating a new Agent instance.
 */
export interface AgentOptions {
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
}

const authTokenMiddleware: Handler = async (req, res, next) => {
  const tokenHash = req.headers['x-openserv-auth-token']

  if (!tokenHash || typeof tokenHash !== 'string') {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const isTokenValid = await bcrypt.compare(AUTH_TOKEN as string, tokenHash)

  if (!isTokenValid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  next()
}

export class Agent {
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
   * @private
   */
  private port: number

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
  protected tools: Array<Capability<z.ZodTypeAny>> = []

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
   * Sets up the Express application, middleware, and routes.
   * Initializes API clients with appropriate authentication.
   *
   * @param {AgentOptions} options - Configuration options for the agent
   * @throws {Error} If OpenServ API key is not provided in options or environment
   */
  constructor(private options: AgentOptions) {
    this.app = express()
    this.router = AsyncRouter()
    this.port = this.options.port || DEFAULT_PORT
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

    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: false }))
    this.app.use(hpp())
    this.app.use(helmet())
    this.app.use(compression())

    if (AUTH_TOKEN) {
      this.app.use(authTokenMiddleware)
    } else {
      logger.warn('OPENSERV_AUTH_TOKEN is not set. All requests will be allowed.')
    }

    this.setupRoutes()
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
      this: Agent,
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
      new Capability(name, description, schema, run) as unknown as Capability<z.ZodTypeAny>
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
        this: Agent,
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
   * @returns {Promise<any>} The files in the workspace
   */
  async getFiles(params: GetFilesParams) {
    const response = await this.apiClient.get(`/workspaces/${params.workspaceId}/files`)
    return response.data
  }

  /**
   * Get all secrets for an agent in a workspace.
   *
   * @param {GetSecretsParams} params - Parameters for the secrets retrieval
   * @returns {Promise<any>} List of agent secrets.
   */
  async getSecrets(params: GetSecretsParams) {
    const response = await this.apiClient.get(`/workspaces/${params.workspaceId}/agent-secrets`)
    return response.data
  }

  /**
   * Get the value of a secret for an agent in a workspace
   *
   * @param {GetSecretValueParams} params - Parameters for the secret value retrieval
   * @returns {Promise<string>} The value of the secret.
   */
  async getSecretValue(params: GetSecretValueParams): Promise<string> {
    const response = await this.apiClient.get(
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
   * @returns {Promise<any>} The uploaded file details
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

    const response = await this.apiClient.post(`/workspaces/${params.workspaceId}/file`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
    return response.data
  }

  /**
   * Deletes a file from a workspace.
   *
   * @param {DeleteFileParams} params - Parameters for the file deletion
   * @param {number} params.workspaceId - ID of the workspace containing the file
   * @param {number} params.fileId - ID of the file to delete
   * @returns {Promise<any>} A success message confirming the file was deleted
   */
  async deleteFile(params: DeleteFileParams): Promise<any> {
    const response = await this.apiClient.delete(
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
   * @returns {Promise<any>} The updated task details
   */
  async markTaskAsErrored(params: MarkTaskAsErroredParams) {
    const response = await this.apiClient.post(
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
   * @returns {Promise<any>} The completed task details
   */
  async completeTask(params: CompleteTaskParams) {
    const response = await this.apiClient.put(
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
   * @returns {Promise<any>} The sent message details
   */
  async sendChatMessage(params: SendChatMessageParams) {
    const response = await this.apiClient.post(
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
   * @returns {Promise<any>} The detailed task information
   */
  async getTaskDetail(params: GetTaskDetailParams) {
    const response = await this.apiClient.get(
      `/workspaces/${params.workspaceId}/tasks/${params.taskId}/detail`
    )
    return response.data
  }

  /**
   * Gets a list of agents in a workspace.
   *
   * @param {GetAgentsParams} params - Parameters for getting agents
   * @param {number} params.workspaceId - ID of the workspace to get agents from
   * @returns {Promise<any>} List of agents in the workspace
   */
  async getAgents(params: GetAgentsParams) {
    const response = await this.apiClient.get(`/workspaces/${params.workspaceId}/agents`)
    return response.data
  }

  /**
   * Gets a list of tasks in a workspace.
   *
   * @param {GetTasksParams} params - Parameters for getting tasks
   * @param {number} params.workspaceId - ID of the workspace to get tasks from
   * @returns {Promise<any>} List of tasks in the workspace
   */
  async getTasks(params: GetTasksParams) {
    const response = await this.apiClient.get(`/workspaces/${params.workspaceId}/tasks`)
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
    const response = await this.apiClient.get(
      `/workspaces/${params.workspaceId}/agent-chat/${params.agentId}/messages`
    )
    return response.data as AgentChatMessagesResponse
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
   * @returns {Promise<any>} The created task details
   */
  async createTask(params: CreateTaskParams) {
    const response = await this.apiClient.post(`/workspaces/${params.workspaceId}/task`, {
      assignee: params.assignee,
      description: params.description,
      body: params.body,
      input: params.input,
      expectedOutput: params.expectedOutput,
      dependencies: params.dependencies
    })
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
   * @returns {Promise<any>} The created log entry details
   */
  async addLogToTask(params: AddLogToTaskParams) {
    const response = await this.apiClient.post(
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
   * @returns {Promise<any>} The created assistance request details
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

    const response = await this.apiClient.post(
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
   * @returns {Promise<any>} The updated task details
   */
  async updateTaskStatus(params: UpdateTaskStatusParams) {
    const response = await this.apiClient.put(
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
        tools: this.tools.map(convertToolToJsonSchema),
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
        tools: this.tools.map(convertToolToJsonSchema),
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
   * @param {Object} req - The request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.toolName - Name of the tool to execute
   * @param {Object} req.body - Request body
   * @param {z.infer<z.ZodTypeAny>} [req.body.args] - Arguments for the tool
   * @param {z.infer<typeof actionSchema>} [req.body.action] - Action context
   * @param {ChatCompletionMessageParam[]} [req.body.messages] - Message history
   * @returns {Promise<{result: string}>} The result of the tool execution
   * @throws {BadRequest} If tool name is missing or tool is not found
   * @throws {Error} If tool execution fails
   */
  async handleToolRoute(req: {
    params: { toolName: string }
    body: {
      args?: z.infer<z.ZodTypeAny>
      action?: z.infer<typeof actionSchema>
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

      const args = await tool.schema.parseAsync(req.body?.args)
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
      const action = await actionSchema.parseAsync(req.body)
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
   * Sets up the Express routes for the agent's HTTP server.
   * Configures health check endpoint and routes for tool execution.
   * @private
   */
  private setupRoutes() {
    this.router.get('/health', async (_req: express.Request, res: express.Response) => {
      res.status(200).json({ status: 'ok', uptime: process.uptime() })
    })

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

    this.app.use('/', this.router)
  }

  /**
   * Starts the agent's HTTP server.
   *
   * @returns {Promise<void>} Resolves when the server has started
   * @throws {Error} If server fails to start
   */
  async start() {
    return new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`Agent server started on port ${this.port}`)
        resolve()
      })
      this.server.on('error', reject)
    })
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
}

function convertToolToJsonSchema(tool: Capability<z.ZodTypeAny>) {
  return {
    name: tool.name,
    description: tool.description,
    schema: zodToJsonSchema(tool.schema)
  }
}
