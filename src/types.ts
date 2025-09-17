import type { z } from 'zod'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

// Helper type for capability function parameters
export type CapabilityFuncParams<Schema extends z.ZodTypeAny> = {
  args: z.infer<Schema>
  action?: ActionSchema
}

export type AgentKind = 'external' | 'eliza' | 'openserv'

export type TaskStatus =
  | 'to-do'
  | 'in-progress'
  | 'human-assistance-required'
  | 'error'
  | 'done'
  | 'cancelled'

type JSONArtifact = {
  id: string
  type: 'json'
  data: Record<string, unknown>
}

type IntegrationType = 'nango' | 'custom' | 'internal'

type IntegrationConnectionSchema = {
  id: string
  type: IntegrationType
  identifier: string
  name: string
  description: string
  scopes: string[]
  connectionName: string
}

type MCPToolSchema = {
  name: string
  description: string | null
  inputSchema: unknown
}

type MCPServerSchema = {
  id: string
  name: string
  description?: string | null
  url: string
  headers?: Record<string, string> | null
  transport: 'http' | 'sse'
  tools: MCPToolSchema[]
}

type ProjectManagerPlanReviewTask = {
  index: number
  assigneeAgentId: number
  assigneeAgentName: string
  taskDescription: string
  taskBody: string
  input: string
  expectedOutput: string
}

type ProjectManagerPlanReviewHumanAssistanceQuestion = {
  tasks: ProjectManagerPlanReviewTask[]
}

type TextHumanAssistanceRequest = {
  type: 'text'
  question: {
    type: 'text'
    question: string
  }
}

type ProjectManagerPlanReviewHumanAssistanceRequest = {
  type: 'project-manager-plan-review'
  question: ProjectManagerPlanReviewHumanAssistanceQuestion & {
    type: 'project-manager-plan-review'
  }
}

type InsufficientBalanceHumanAssistanceRequest = {
  type: 'insufficient-balance'
  question: {
    type: 'insufficient-balance'
  }
}

type JSONHumanAssistanceRequest = {
  type: 'json'
  question: {
    type: 'json'
    question: unknown
  }
}

type HumanAssistanceRequest =
  | TextHumanAssistanceRequest
  | ProjectManagerPlanReviewHumanAssistanceRequest
  | InsufficientBalanceHumanAssistanceRequest
  | JSONHumanAssistanceRequest

type TriggerEvent = {
  name: string
  description?: string | null
  integrationName?: string | null
  integrationType: IntegrationType
  trigger_name?: string | null
  payload: {
    event: unknown
    summary: string
  }[]
}

type TaskDependency = {
  id: number | string
  description: string
  output?: string | null
  status: TaskStatus
  attachments: {
    id: string
    path: string
    fullUrl: string
    summary?: string | null
  }[]
}

type WorkspaceAgent = {
  id: number
  name: string
  capabilities_description: string
  integrations?: IntegrationConnectionSchema[]
}

type ExecutionStatus =
  | 'error'
  | 'active'
  | 'deleted'
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'timed-out'

type ActionWorkspace = {
  id: number | string
  goal: string
  bucket_folder: string
  latest_workspace_execution_status?: ExecutionStatus
  agents: WorkspaceAgent[]
}

type NoCodeActionAssignee = {
  id: number
  name: string
  kind: AgentKind
  isBuiltByAgentBuilder: true
  systemPrompt: string
}

type CustomActionAssignee = {
  id: number
  name: string
  kind: AgentKind
  isBuiltByAgentBuilder: false
}

type ActionAssignee = NoCodeActionAssignee | CustomActionAssignee

type Memory = {
  id: number
  memory: string
  createdAt: string | Date
}

type SessionHistoryTask = {
  id: number
  description: string
  body?: string | null
  expectedOutput?: string | null
  input?: string | null
  output?: string | null
}

type SessionHistoryItem = {
  tasks: SessionHistoryTask[]
  triggerEvents: TriggerEvent[]
}

type AgentKnowledgeFile = {
  id: number
  path: string
  state: 'pending' | 'processing' | 'processed' | 'error' | 'skipped'
}

export type DoTaskActionSchema = {
  type: 'do-task'
  workspaceUpdateToken?: string | null
  taskUpdateToken?: string | null
  explicitInput?: unknown | null
  triggerEvents?: TriggerEvent[]
  sessionHistory?: SessionHistoryItem[]
  me: ActionAssignee
  task: {
    id: number | string
    description: string
    body?: string | null
    expectedOutput?: string | null
    input?: string | null
    dependencies: TaskDependency[]
    humanAssistanceRequests: (HumanAssistanceRequest & {
      agentDump: unknown
      humanResponse?: string | null
      id: number
      status: 'pending' | 'responded'
    })[]
    triggerEvent?: TriggerEvent | null
  }
  workspace: ActionWorkspace
  workspaceExecutionId?: number
  integrations: IntegrationConnectionSchema[]
  mcpServers?: MCPServerSchema[]
  agentKnowledgeFiles?: AgentKnowledgeFile[]
  memories: Memory[]
}

type ArtifactCard = {
  id: string
  type: 'artifact-card'
  data: unknown
}

type ArtifactCardResponse = {
  id: string
  type: 'artifact-card-response'
  artifactId: string
  data: unknown | null
}

type ChatMessageArtifact = JSONArtifact | ArtifactCard | ArtifactCardResponse

type ChatMessageParts = {
  artifacts: ChatMessageArtifact[]
}

type ChatMessage = {
  author: 'agent' | 'user'
  createdAt: string | Date
  id: number
  message: string
  parts: ChatMessageParts
}

export type RespondChatMessageActionSchema = {
  type: 'respond-chat-message'
  workspaceUpdateToken?: string | null
  me: ActionAssignee
  messages: ChatMessage[]
  workspace: ActionWorkspace
  integrations: IntegrationConnectionSchema[]
  memories: Memory[]
}

export type ActionSchema = DoTaskActionSchema | RespondChatMessageActionSchema

export type AgentChatMessagesResponse = {
  agent: {
    id: number
    name: string
  }
  messages: {
    author: 'agent' | 'user'
    createdAt: Date
    id: number
    message: string
  }[]
}

type WorkspaceId = string | number
type TaskId = string | number

export interface GetFilesParams {
  workspaceId: WorkspaceId | string
}

export type GetFilesResponse = {
  id: number
  path: string
  fullUrl: string
  summary: string
  size: number
}[]

export interface GetSecretsParams {
  workspaceId: WorkspaceId
}

export type GetSecretsResponse = {
  id: number
  name: string
}[]

export interface GetSecretValueParams {
  workspaceId: WorkspaceId
  secretId: number
}

export type GetSecretValueResponse = string

export interface UploadFileParams {
  workspaceId: WorkspaceId
  path: string
  taskIds?: TaskId[] | TaskId | null
  skipSummarizer?: boolean
  file: Buffer | string
}

export type UploadFileResponse = {
  fileId: number
  fullUrl: string
  summary?: string
}

export interface DeleteFileParams {
  workspaceId: WorkspaceId
  fileId: number
}

export type DeleteFileResponse = {
  message: string
}

export interface MarkTaskAsErroredParams {
  workspaceId: WorkspaceId
  taskId: TaskId
  error: string
}

export type MarkTaskAsErroredResponse = undefined

export interface CompleteTaskParams {
  workspaceId: WorkspaceId
  taskId: TaskId
  output: string
}

export type CompleteTaskResponse = undefined

export interface SendChatMessageParams {
  workspaceId: WorkspaceId
  agentId: number
  message: string
}

export type SendChatMessageResponse = undefined

export interface GetTaskDetailParams {
  workspaceId: WorkspaceId
  taskId: TaskId
}

export type GetTaskDetailResponse = {
  assigneeAgentId: number
  assigneeAgentName: string
  id: number
  body?: string | null
  description: string
  input?: string | null
  expectedOutput?: string | null
  output?: string | null
  reporterAgentId: number
  reporterAgentName: string
  status: TaskStatus
  attachments: {
    id: number
    path: string
    fullUrl: string
    summary?: string | null
  }[]
}

export interface GetAgentsParams {
  workspaceId: WorkspaceId
}

export type GetAgentsResponse = {
  id: number
  name: string
  capabilitiesDescription: string
}[]

export interface GetChatMessagesParams {
  workspaceId: WorkspaceId
  agentId: number
}

export interface GetTasksParams {
  workspaceId: WorkspaceId
}

export type GetTasksResponse = {
  id: number
  description: string
  status: TaskStatus
  output?: string | null
  assigneeAgentId: number
  assigneeAgentName: string
  dependencies: { dependency_task_id: number }[]
  triggerDependencies: { dependency_trigger_id: string }[]
}[]

export interface CreateTaskParams {
  workspaceId: WorkspaceId
  assignee: number
  description: string
  body: string
  input: string
  expectedOutput: string
  dependencies: number[] | string[]
}

export type CreateTaskResponse = {
  id: number
}

export interface AddLogToTaskParams {
  workspaceId: WorkspaceId
  taskId: TaskId
  severity: 'info' | 'warning' | 'error'
  type: 'text' | 'openai-message'
  body: string | object
}

export type AddLogToTaskResponse = undefined

export interface RequestHumanAssistanceParams {
  workspaceId: WorkspaceId
  taskId: TaskId
  type: 'text' | 'project-manager-plan-review'
  question: string | object
  agentDump?: object
}

export type RequestHumanAssistanceResponse = undefined

export interface UpdateTaskStatusParams {
  workspaceId: WorkspaceId
  taskId: TaskId
  status: TaskStatus
}

export type UpdateTaskStatusResponse = undefined

export interface ProcessParams {
  messages: ChatCompletionMessageParam[]
}

export interface ProxyConfiguration {
  endpoint: string
  providerConfigKey?: string
  connectionId?: string
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'get' | 'post' | 'patch' | 'put' | 'delete'
  headers?: Record<string, string>
  params?: string | Record<string, string | number>
  data?: unknown
  retries?: number
  baseUrlOverride?: string
  decompress?: boolean
  responseType?: 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream'
  retryOn?: number[] | null
}

export interface IntegrationCallRequest {
  workspaceId: WorkspaceId
  integrationId: string
  details: ProxyConfiguration
}
