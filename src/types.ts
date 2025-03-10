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

export const doTaskActionSchema = z
  .object({
    type: z.literal('do-task'),
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
      id: z.number().openapi({ description: 'The ID of the task' }),
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
            question: z.string().openapi({ description: "Agent's question for the user" }),
            status: z.enum(['pending', 'responded']),
            type: z.enum(['text', 'project-manager-plan-review']).openapi({
              description:
                "'project-manager-plan-review' is initiaded by a Project Manager agent to let the user confirm the project plan for this workspace."
            })
          })
          .openapi({ description: 'List of Human Assistance Requests' })
      )
    }),
    workspace: z.object({
      id: z.number(),
      goal: z.string(),
      bucket_folder: z.string(),
      agents: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          capabilities_description: z.string()
        })
      )
    }),
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
    me: z.intersection(
      z.object({
        id: z.number(),
        name: z.string(),
        kind: agentKind
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
        message: z.string()
      })
    ),
    workspace: z.object({
      id: z.number(),
      goal: z.string(),
      bucket_folder: z.string(),
      agents: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          capabilities_description: z.string()
        })
      )
    }),
    integrations: z.array(
      z.object({
        id: z.number(),
        connection_id: z.string(),
        provider_config_key: z.string(),
        provider: z.string(),
        created: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).nullish().optional(),
        scopes: z.array(z.string()).optional(),
        openAPI: z.object({
          title: z.string(),
          description: z.string()
        })
      })
    ),
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

export interface GetFilesParams {
  workspaceId: number
}

export interface GetSecretsParams {
  workspaceId: number
}
export interface GetSecretValueParams {
  workspaceId: number
  secretId: number
}

export const getFilesParamsSchema = z.object({
  workspaceId: z.number().int().positive()
})

export interface UploadFileParams {
  workspaceId: number
  path: string
  taskIds?: number[] | number | null
  skipSummarizer?: boolean
  file: Buffer | string
}

export interface MarkTaskAsErroredParams {
  workspaceId: number
  taskId: number
  error: string
}

export interface CompleteTaskParams {
  workspaceId: number
  taskId: number
  output: string
}

export interface SendChatMessageParams {
  workspaceId: number
  agentId: number
  message: string
}

export interface GetTaskDetailParams {
  workspaceId: number
  taskId: number
}

export interface GetAgentsParams {
  workspaceId: number
}

export interface GetTasksParams {
  workspaceId: number
}

export interface CreateTaskParams {
  workspaceId: number
  assignee: number
  description: string
  body: string
  input: string
  expectedOutput: string
  dependencies: number[]
}

export interface AddLogToTaskParams {
  workspaceId: number
  taskId: number
  severity: 'info' | 'warning' | 'error'
  type: 'text' | 'openai-message'
  body: string | object
}

export interface RequestHumanAssistanceParams {
  workspaceId: number
  taskId: number
  type: 'text' | 'project-manager-plan-review'
  question: string | object
  agentDump?: object
}

export interface UpdateTaskStatusParams {
  workspaceId: number
  taskId: number
  status: TaskStatus
}

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
  workspaceId: number
  integrationId: string
  details: ProxyConfiguration
}
