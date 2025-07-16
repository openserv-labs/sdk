import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

extendZodWithOpenApi(z)

// Helper type for capability function parameters
export type CapabilityFuncParams<Schema extends z.ZodTypeAny> = {
  args: z.infer<Schema>
  action?: z.infer<typeof actionSchema>
}

export const agentKind = z.enum(['external', 'eliza', 'openserv'])

export const taskStatusSchema = z
  .enum(['to-do', 'in-progress', 'human-assistance-required', 'error', 'done', 'cancelled'])
  .openapi('taskStatusSchema')

export type TaskStatus = z.infer<typeof taskStatusSchema>

const triggerEventPayloadWithSummarySchema = z.object({
  event: z.unknown(),
  summary: z.string()
})

export const chatMessageArtifacts = z.array(
  z.intersection(
    z.object({
      id: z.string()
    }),
    z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('json'),
          data: z.record(z.string(), z.unknown())
        })
        .openapi({
          description:
            "type is 'json' and the data is a JSON object. This is what your agents will typically use."
        }),
      z
        .object({
          type: z.literal('artifact-card'),
          data: z.unknown()
        })
        .openapi({
          description:
            "type is 'artifact-card' and the data is a JSON object. This is what your users will typically use to respond to the agent's artifact."
        }),
      z
        .object({
          type: z.literal('artifact-card-response'),
          artifactId: z.string(),
          data: z.unknown().nullish()
        })
        .openapi({
          description:
            "type is 'artifact-card-response' and the artifactId is the id of the artifact that the user responded to."
        })
    ])
  )
)

export const chatMessageParts = z.object({
  artifacts: chatMessageArtifacts
})

const integrationConnectionSchema = z.object({
  id: z.string(),
  type: z.enum(['nango', 'custom', 'internal']),
  identifier: z.string(),
  name: z.string(),
  description: z.string(),
  scopes: z.array(z.string()),
  connectionName: z.string()
})

const mcpServersSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).nullish(),
    transport: z.enum(['http', 'sse']),
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string().nullish(),
        inputSchema: z.any()
      })
    )
  })
)

const projectManagerPlanReviewHumanAssistanceQuestionSchema = z.object({
  tasks: z.array(
    z.object({
      index: z.number(),
      assigneeAgentId: z.number().int(),
      assigneeAgentName: z.string(),
      taskDescription: z.string(),
      taskBody: z.string(),
      input: z.string(),
      expectedOutput: z.string()
    })
  )
})

const baseHumanAssistanceRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      question: z.object({
        type: z.literal('text'),
        question: z.string().trim().min(1).openapi({ description: 'Your question for the user' })
      })
    })
    .openapi({
      description:
        "The type is 'text' and the question is a known object. This is what your agents will typically use."
    }),
  z.object({
    type: z.literal('project-manager-plan-review'),
    question: projectManagerPlanReviewHumanAssistanceQuestionSchema.extend({
      type: z.literal('project-manager-plan-review')
    })
  }),
  z.object({
    type: z.literal('insufficient-balance'),
    question: z.object({
      type: z.literal('insufficient-balance')
    })
  }),
  z.object({
    type: z.literal('json'),
    question: z.any()
  })
])

export const doTaskActionSchema = z
  .object({
    type: z.literal('do-task'),
    workspaceUpdateToken: z.string().nullish(),
    taskUpdateToken: z.string().nullish(),
    explicitInput: z.unknown().nullish(),
    triggerEvents: z.array(
      z.object({
        name: z.string(),
        description: z.string().nullish(),
        integrationName: z.string().nullish(),
        integrationType: z.enum(['nango', 'custom', 'internal']),
        trigger_name: z.string().nullish(),
        payload: z.array(triggerEventPayloadWithSummarySchema)
      })
    ),
    sessionHistory: z
      .array(
        z.object({
          tasks: z.array(
            z.object({
              id: z.number().openapi({ description: 'The ID of the task' }),
              description: z.string().openapi({
                description:
                  "Short description of the task. Usually in the format of 'Do [something]'"
              }),
              body: z.string().nullish().openapi({
                description:
                  'Additional task information or data. Usually 2-3 sentences if available.'
              }),
              expectedOutput: z
                .string()
                .nullish()
                .openapi({ description: 'Preferred output of the task' }),
              input: z.string().nullish().openapi({
                description:
                  "The input information for the task. Typically, it's an output of another task."
              }),
              output: z.string().nullish().openapi({
                description: 'The output of the task. This is the result of the task.'
              })
            })
          ),
          triggerEvents: z
            .array(
              z.object({
                name: z.string(),
                description: z.string().nullish(),
                integrationName: z.string().nullish(),
                integrationType: z.enum(['nango', 'custom', 'internal']),
                trigger_name: z.string().nullish(),
                payload: z.array(triggerEventPayloadWithSummarySchema)
              })
            )
            .openapi({
              description:
                'The optional payload of the trigger that triggered the task execution for a session'
            })
        })
      )
      .optional()
      .openapi({
        description:
          'The optional payload of the trigger that triggered the task execution for a session'
      }),
    me: z
      .intersection(
        z.object({
          id: z.number(),
          name: z.string(),
          kind: agentKind
        }),
        z
          .union([
            z.object({
              isBuiltByAgentBuilder: z.literal(false)
            }),
            z.object({
              isBuiltByAgentBuilder: z.literal(true),
              systemPrompt: z.string()
            })
          ])
          .openapi({
            description: 'This information is for internal agents only'
          })
      )
      .openapi({ description: 'Your agent instance' }),
    task: z.object({
      id: z.union([z.number(), z.string()]).openapi({ description: 'The ID of the task' }),
      description: z.string().openapi({
        description: "Short description of the task. Usually in the format of 'Do [something]'"
      }),
      body: z.string().nullish().openapi({
        description: 'Additional task information or data. Usually 2-3 sentences if available.'
      }),
      expectedOutput: z.string().nullish().openapi({ description: 'Preferred output of the task' }),
      input: z.string().nullish().openapi({
        description:
          "The input information for the task. Typically, it's an output of another task."
      }),
      dependencies: z
        .array(
          z.object({
            id: z.number(),
            description: z.string(),
            output: z.string().nullish(),
            status: taskStatusSchema,
            attachments: z.array(
              z.object({
                id: z.number(),
                path: z.string(),
                fullUrl: z.string(),
                summary: z.string().nullish()
              })
            )
          })
        )
        .openapi({ description: 'List of dependant tasks' }),
      humanAssistanceRequests: z.array(
        z.intersection(
          baseHumanAssistanceRequestSchema,
          z
            .object({
              agentDump: z.unknown().openapi({
                description:
                  "Agent's internal data. Anything the agent wanted to store in the context of this human assistant request."
              }),
              humanResponse: z
                .string()
                .nullish()
                .openapi({ description: "Human's response to the question" }),
              id: z.number(),
              status: z.enum(['pending', 'responded'])
            })
            .openapi({ description: 'List of Human Assistance Requests' })
        )
      )
    }),
    triggerEvent: z
      .object({
        name: z.string(),
        description: z.string().nullish(),
        integrationName: z.string().nullish(),
        integrationType: z.enum(['nango', 'custom', 'internal']),
        trigger_name: z.string().nullish(),
        payload: z.array(triggerEventPayloadWithSummarySchema)
      })
      .optional()
      .openapi({
        description: 'The optional payload of the trigger that triggered the task execution'
      }),
    workspace: z.object({
      id: z.union([z.number(), z.string()]),
      goal: z.string(),
      bucket_folder: z.string(),
      agents: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          capabilities_description: z.string(),
          integrations: z.array(integrationConnectionSchema).optional()
        })
      )
    }),
    workspaceExecutionId: z.number().optional(),
    integrations: z.array(
      z.object({
        id: z.number(),
        connection_id: z.string(),
        provider_config_key: z.string(),
        provider: z.string(),
        created: z.string(),
        metadata: z.record(z.string(), z.unknown()).nullish(),
        scopes: z.array(z.string()).optional(),
        openAPI: z.object({
          title: z.string(),
          description: z.string()
        })
      })
    ),
    mcpServers: mcpServersSchema.optional(),
    agentKnowledgeFiles: z
      .array(
        z.object({
          id: z.number(),
          path: z.string(),
          state: z.enum(['pending', 'processing', 'processed', 'error', 'skipped'])
        })
      )
      .optional(),
    memories: z.array(
      z.object({
        id: z.number(),
        memory: z.string(),
        createdAt: z.coerce.date()
      })
    )
  })
  .openapi('doTaskActionSchema')

export const respondChatMessageActionSchema = z
  .object({
    type: z.literal('respond-chat-message'),
    workspaceUpdateToken: z.string().nullish(),
    me: z.intersection(
      z.object({
        id: z.number(),
        uid: z.string().optional(),
        name: z.string(),
        kind: z.enum(['external', 'eliza', 'openserv'])
      }),
      z.discriminatedUnion('isBuiltByAgentBuilder', [
        z.object({
          isBuiltByAgentBuilder: z.literal(false)
        }),
        z.object({
          isBuiltByAgentBuilder: z.literal(true),
          systemPrompt: z.string()
        })
      ])
    ),
    messages: z.array(
      z.object({
        author: z.enum(['agent', 'user']),
        createdAt: z.coerce.date(),
        id: z.number(),
        message: z.string(),
        parts: chatMessageParts
      })
    ),
    workspace: z.object({
      id: z.union([z.number(), z.string()]),
      goal: z.string(),
      bucket_folder: z.string(),
      latest_workspace_execution_status: z.enum([
        'error',
        'active',
        'deleted',
        'idle',
        'running',
        'paused',
        'completed',
        'timed-out'
      ]),
      agents: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          capabilities_description: z.string(),
          integrations: z.array(integrationConnectionSchema).optional()
        })
      )
    }),
    integrations: z.array(integrationConnectionSchema),
    mcpServers: mcpServersSchema.optional(),
    agentKnowledgeFiles: z
      .array(
        z.object({
          id: z.number(),
          path: z.string(),
          state: z.enum(['pending', 'processing', 'processed', 'error', 'skipped'])
        })
      )
      .optional(),
    memories: z.array(
      z.object({
        id: z.number(),
        memory: z.string(),
        createdAt: z.coerce.date()
      })
    )
  })
  .openapi('respondChatMessageActionSchema')

export const actionSchema = z.discriminatedUnion('type', [
  doTaskActionSchema,
  respondChatMessageActionSchema
])

const agentChatMessagesResponseSchema = z.object({
  agent: z.object({
    id: z.number(),
    name: z.string()
  }),
  messages: z.array(
    z.object({
      author: z.enum(['agent', 'user']),
      createdAt: z.coerce.date(),
      id: z.number(),
      message: z.string()
    })
  )
})

export type AgentChatMessagesResponse = z.infer<typeof agentChatMessagesResponseSchema>

export interface GetFilesParams {
  workspaceId: number | string
}

export type GetFilesResponse = {
  id: number
  path: string
  fullUrl: string
  summary: string
  size: number
}[]

export interface GetSecretsParams {
  workspaceId: number | string
}

export type GetSecretsResponse = {
  id: number
  name: string
}[]

export interface GetSecretValueParams {
  workspaceId: number | string
  secretId: number
}

export type GetSecretValueResponse = string

export const getFilesParamsSchema = z.object({
  workspaceId: z.number().int().positive()
})

export interface UploadFileParams {
  workspaceId: number | string
  path: string
  taskIds?: number[] | number | null
  skipSummarizer?: boolean
  file: Buffer | string
}

export type UploadFileResponse = {
  fileId: number
  fullUrl: string
  summary?: string
}

export interface DeleteFileParams {
  workspaceId: number | string
  fileId: number
}

export type DeleteFileResponse = {
  message: string
}

export interface MarkTaskAsErroredParams {
  workspaceId: number | string
  taskId: number | string
  error: string
}

export type MarkTaskAsErroredResponse = undefined

export interface CompleteTaskParams {
  workspaceId: number | string
  taskId: number | string
  output: string
}

export type CompleteTaskResponse = undefined

export interface SendChatMessageParams {
  workspaceId: number | string
  agentId: number
  message: string
}

export type SendChatMessageResponse = undefined

export interface GetTaskDetailParams {
  workspaceId: number | string
  taskId: number | string
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
  workspaceId: number | string
}

export type GetAgentsResponse = {
  id: number
  name: string
  capabilitiesDescription: string
}[]

export interface GetChatMessagesParams {
  workspaceId: number | string
  agentId: number
}

export interface GetTasksParams {
  workspaceId: number | string
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
  workspaceId: number | string
  assignee: number
  description: string
  body: string
  input: string
  expectedOutput: string
  dependencies: number[]
}

export type CreateTaskResponse = {
  id: number
}

export interface AddLogToTaskParams {
  workspaceId: number | string
  taskId: number | string
  severity: 'info' | 'warning' | 'error'
  type: 'text' | 'openai-message'
  body: string | object
}

export type AddLogToTaskResponse = undefined

export interface RequestHumanAssistanceParams {
  workspaceId: number | string
  taskId: number | string
  type: 'text' | 'project-manager-plan-review'
  question: string | object
  agentDump?: object
}

export type RequestHumanAssistanceResponse = undefined

export interface UpdateTaskStatusParams {
  workspaceId: number | string
  taskId: number | string
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
  workspaceId: number | string
  integrationId: string
  details: ProxyConfiguration
}
