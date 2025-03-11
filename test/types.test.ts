import assert from 'node:assert'
import { describe, test } from 'node:test'
import {
  actionSchema,
  doTaskActionSchema,
  respondChatMessageActionSchema,
  UploadFileParams,
  GetFilesParams,
  MarkTaskAsErroredParams,
  CompleteTaskParams,
  SendChatMessageParams,
  GetTaskDetailParams,
  agentKind,
  taskStatusSchema,
  GetAgentsParams,
  GetTasksParams,
  CreateTaskParams,
  AddLogToTaskParams,
  RequestHumanAssistanceParams,
  UpdateTaskStatusParams,
  ProcessParams,
  getFilesParamsSchema
} from '../src/types'

describe('Action Schemas', () => {
  test('should validate do-task action', () => {
    const action = {
      type: 'do-task',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      },
      task: {
        id: 1,
        description: 'test task',
        body: 'test body',
        expectedOutput: 'test output',
        input: 'test input',
        dependencies: [],
        humanAssistanceRequests: []
      },
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: []
      },
      integrations: [],
      memories: []
    }

    const result = doTaskActionSchema.parse(action)
    assert.deepStrictEqual(result, action)
  })

  test('should validate respond-chat-message action', () => {
    const action = {
      type: 'respond-chat-message',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      },
      messages: [
        {
          author: 'user',
          createdAt: new Date(),
          id: 1,
          message: 'test message'
        }
      ],
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: []
      },
      integrations: [],
      memories: []
    }

    const result = respondChatMessageActionSchema.parse(action)
    assert.deepStrictEqual(result, action)
  })

  test('should validate action with discriminated union', () => {
    const doTaskAction = {
      type: 'do-task',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      },
      task: {
        id: 1,
        description: 'test task',
        body: 'test body',
        expectedOutput: 'test output',
        input: 'test input',
        dependencies: [],
        humanAssistanceRequests: []
      },
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: []
      },
      integrations: [],
      memories: []
    }

    const respondChatAction = {
      type: 'respond-chat-message',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      },
      messages: [
        {
          author: 'user',
          createdAt: new Date(),
          id: 1,
          message: 'test message'
        }
      ],
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: []
      },
      integrations: [],
      memories: []
    }

    const doTaskResult = actionSchema.parse(doTaskAction)
    assert.deepStrictEqual(doTaskResult, doTaskAction)

    const respondChatResult = actionSchema.parse(respondChatAction)
    assert.deepStrictEqual(respondChatResult, respondChatAction)
  })

  test('should reject invalid action type', () => {
    const action = {
      type: 'invalid-type',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      }
    }

    assert.throws(() => actionSchema.parse(action))
  })

  test('should reject invalid do-task action', () => {
    const action = {
      type: 'do-task',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'invalid-kind',
        isBuiltByAgentBuilder: false
      }
    }

    assert.throws(() => doTaskActionSchema.parse(action))
  })

  test('should reject invalid respond-chat-message action', () => {
    const action = {
      type: 'respond-chat-message',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      },
      messages: [
        {
          author: 'invalid-author',
          createdAt: new Date(),
          id: 1,
          message: 'test message'
        }
      ]
    }

    assert.throws(() => respondChatMessageActionSchema.parse(action))
  })

  test('should validate UploadFileParams with all variations', () => {
    // Test with array of taskIds
    const params1: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content',
      taskIds: [1, 2, 3],
      skipSummarizer: true
    }
    assert.ok(params1)

    // Test with single taskId
    const params2: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content',
      taskIds: 1
    }
    assert.ok(params2)

    // Test with null taskIds
    const params3: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content',
      taskIds: null
    }
    assert.ok(params3)

    // Test with skipSummarizer false
    const params4: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content',
      skipSummarizer: false
    }
    assert.ok(params4)

    // Test with Buffer file
    const params5: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: Buffer.from('test content')
    }
    assert.ok(params5)

    // Test with minimum required fields
    const params6: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content'
    }
    assert.ok(params6)
  })

  test('should validate GetFilesParams', () => {
    // Test valid case
    const params: GetFilesParams = {
      workspaceId: 1
    }
    const result = getFilesParamsSchema.parse(params)
    assert.deepStrictEqual(result, params)

    // Test invalid workspaceId types
    assert.throws(() => {
      getFilesParamsSchema.parse({
        workspaceId: '1'
      })
    }, /Expected number, received string/)

    assert.throws(() => {
      getFilesParamsSchema.parse({
        workspaceId: null
      })
    }, /Expected number, received null/)

    assert.throws(() => {
      getFilesParamsSchema.parse({
        workspaceId: undefined
      })
    }, /Required/)

    // Test with missing workspaceId
    assert.throws(() => {
      getFilesParamsSchema.parse({})
    }, /Required/)

    // Test with negative workspaceId
    assert.throws(() => {
      getFilesParamsSchema.parse({
        workspaceId: -1
      })
    }, /Number must be greater than 0/)

    // Test with zero workspaceId
    assert.throws(() => {
      getFilesParamsSchema.parse({
        workspaceId: 0
      })
    }, /Number must be greater than 0/)

    // Test with decimal workspaceId
    assert.throws(() => {
      getFilesParamsSchema.parse({
        workspaceId: 1.5
      })
    }, /Expected integer, received float/)
  })

  test('should validate MarkTaskAsErroredParams', () => {
    const params: MarkTaskAsErroredParams = {
      workspaceId: 1,
      taskId: 2,
      error: 'Test error message'
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.taskId, 'number')
    assert.strictEqual(typeof params.error, 'string')
  })

  test('should validate CompleteTaskParams', () => {
    const params: CompleteTaskParams = {
      workspaceId: 1,
      taskId: 2,
      output: 'Test task output'
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.taskId, 'number')
    assert.strictEqual(typeof params.output, 'string')
  })

  test('should validate SendChatMessageParams', () => {
    const params: SendChatMessageParams = {
      workspaceId: 1,
      agentId: 2,
      message: 'Test chat message'
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.agentId, 'number')
    assert.strictEqual(typeof params.message, 'string')
  })

  test('should validate GetTaskDetailParams', () => {
    const params: GetTaskDetailParams = {
      workspaceId: 1,
      taskId: 2
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.taskId, 'number')
  })

  test('should validate agent kind', () => {
    assert.strictEqual(agentKind.parse('external'), 'external')
    assert.strictEqual(agentKind.parse('eliza'), 'eliza')
    assert.strictEqual(agentKind.parse('openserv'), 'openserv')
    assert.throws(() => agentKind.parse('invalid'))
  })

  test('should validate task status', () => {
    assert.strictEqual(taskStatusSchema.parse('to-do'), 'to-do')
    assert.strictEqual(taskStatusSchema.parse('in-progress'), 'in-progress')
    assert.strictEqual(
      taskStatusSchema.parse('human-assistance-required'),
      'human-assistance-required'
    )
    assert.strictEqual(taskStatusSchema.parse('error'), 'error')
    assert.strictEqual(taskStatusSchema.parse('done'), 'done')
    assert.strictEqual(taskStatusSchema.parse('cancelled'), 'cancelled')
    assert.throws(() => taskStatusSchema.parse('invalid'))
  })

  test('should validate do-task action with agent builder', () => {
    const action = {
      type: 'do-task',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: true,
        systemPrompt: 'You are a test agent'
      },
      task: {
        id: 1,
        description: 'test task',
        body: 'test body',
        expectedOutput: 'test output',
        input: 'test input',
        dependencies: [],
        humanAssistanceRequests: []
      },
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: []
      },
      integrations: [],
      memories: []
    }

    const result = doTaskActionSchema.parse(action)
    assert.deepStrictEqual(result, action)
  })

  test('should validate GetAgentsParams', () => {
    const params: GetAgentsParams = {
      workspaceId: 1
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
  })

  test('should validate GetTasksParams', () => {
    const params: GetTasksParams = {
      workspaceId: 1
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
  })

  test('should validate CreateTaskParams', () => {
    const params: CreateTaskParams = {
      workspaceId: 1,
      assignee: 2,
      description: 'Test task',
      body: 'Test body',
      input: 'Test input',
      expectedOutput: 'Test output',
      dependencies: [3, 4]
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.assignee, 'number')
    assert.strictEqual(typeof params.description, 'string')
    assert.strictEqual(typeof params.body, 'string')
    assert.strictEqual(typeof params.input, 'string')
    assert.strictEqual(typeof params.expectedOutput, 'string')
    assert.ok(Array.isArray(params.dependencies))
  })

  test('should validate AddLogToTaskParams', () => {
    const textParams: AddLogToTaskParams = {
      workspaceId: 1,
      taskId: 2,
      severity: 'info',
      type: 'text',
      body: 'Test log message'
    }
    assert.ok(textParams)

    const openaiParams: AddLogToTaskParams = {
      workspaceId: 1,
      taskId: 2,
      severity: 'warning',
      type: 'openai-message',
      body: { role: 'assistant', content: 'Test message' }
    }
    assert.ok(openaiParams)
  })

  test('should validate RequestHumanAssistanceParams', () => {
    const textParams: RequestHumanAssistanceParams = {
      workspaceId: 1,
      taskId: 2,
      type: 'text',
      question: {
        type: 'text',
        question: 'Test question'
      }
    }
    assert.ok(textParams)

    const reviewParams: RequestHumanAssistanceParams = {
      workspaceId: 1,
      taskId: 2,
      type: 'project-manager-plan-review',
      question: { type: 'project-manager-plan-review', tasks: [] },
      agentDump: { data: 'Test data' }
    }
    assert.ok(reviewParams)
  })

  test('should validate UpdateTaskStatusParams', () => {
    const params: UpdateTaskStatusParams = {
      workspaceId: 1,
      taskId: 2,
      status: 'in-progress'
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.taskId, 'number')
    assert.strictEqual(params.status, 'in-progress')
  })

  test('should validate ProcessParams', () => {
    const params: ProcessParams = {
      messages: [
        { role: 'user', content: 'Test message' },
        { role: 'assistant', content: 'Test response' }
      ]
    }
    assert.ok(params)
    assert.ok(Array.isArray(params.messages))
    assert.strictEqual(params.messages[0].role, 'user')
    assert.strictEqual(params.messages[1].role, 'assistant')
  })

  test('should validate task dependencies', () => {
    const action = {
      type: 'do-task',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      },
      task: {
        id: 1,
        description: 'test task',
        body: 'test body',
        expectedOutput: 'test output',
        input: 'test input',
        dependencies: [
          {
            id: 2,
            description: 'dependency task',
            output: 'dependency output',
            status: 'done',
            attachments: [
              {
                id: 3,
                path: 'test.txt',
                fullUrl: 'http://example.com/test.txt',
                summary: 'test summary'
              }
            ]
          }
        ],
        humanAssistanceRequests: []
      },
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: []
      },
      integrations: [],
      memories: []
    }

    const result = doTaskActionSchema.parse(action)
    assert.deepStrictEqual(result, action)

    // Test with nullish fields
    const actionWithNullish = {
      ...action,
      task: {
        ...action.task,
        dependencies: [
          {
            id: 2,
            description: 'dependency task',
            output: null,
            status: 'done',
            attachments: [
              {
                id: 3,
                path: 'test.txt',
                fullUrl: 'http://example.com/test.txt',
                summary: null
              }
            ]
          }
        ]
      }
    }

    const resultWithNullish = doTaskActionSchema.parse(actionWithNullish)
    assert.deepStrictEqual(resultWithNullish, actionWithNullish)
  })

  test('should validate human assistance requests', () => {
    const action = {
      type: 'do-task',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      },
      task: {
        id: 1,
        description: 'test task',
        body: 'test body',
        expectedOutput: 'test output',
        input: 'test input',
        dependencies: [],
        humanAssistanceRequests: [
          {
            id: 2,
            type: 'text',
            question: {
              type: 'text',
              question: 'test question'
            },
            status: 'pending',
            agentDump: { data: 'test data' },
            humanResponse: null
          },
          {
            id: 3,
            type: 'project-manager-plan-review',
            question: {
              type: 'project-manager-plan-review',
              tasks: []
            },
            status: 'responded',
            agentDump: { plan: 'test plan' },
            humanResponse: 'approved'
          }
        ]
      },
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: []
      },
      integrations: [],
      memories: []
    }

    const result = doTaskActionSchema.parse(action)
    assert.deepStrictEqual(result, action)
  })

  test('should validate integrations', () => {
    const action = {
      type: 'do-task',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: false
      },
      task: {
        id: 1,
        description: 'test task',
        body: 'test body',
        expectedOutput: 'test output',
        input: 'test input',
        dependencies: [],
        humanAssistanceRequests: []
      },
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: [
          {
            id: 2,
            name: 'test agent',
            capabilities_description: 'test capabilities'
          }
        ]
      },
      integrations: [
        {
          id: 3,
          connection_id: 'test-connection',
          provider_config_key: 'test-provider',
          provider: 'test',
          created: '2024-01-01',
          metadata: { key: 'value' },
          scopes: ['read', 'write'],
          openAPI: {
            title: 'Test API',
            description: 'Test API description'
          }
        },
        {
          id: 4,
          connection_id: 'test-connection-2',
          provider_config_key: 'test-provider-2',
          provider: 'test-2',
          created: '2024-01-02',
          metadata: null,
          openAPI: {
            title: 'Test API 2',
            description: 'Test API description 2'
          }
        }
      ],
      memories: [
        {
          id: 5,
          memory: 'test memory',
          createdAt: new Date('2024-01-01')
        }
      ]
    }

    const result = doTaskActionSchema.parse(action)
    assert.deepStrictEqual(result, action)
  })

  test('should validate respond-chat-message action with all fields', () => {
    const action = {
      type: 'respond-chat-message',
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external',
        isBuiltByAgentBuilder: true,
        systemPrompt: 'You are a test agent'
      },
      messages: [
        {
          author: 'user',
          createdAt: new Date(),
          id: 1,
          message: 'test message'
        },
        {
          author: 'agent',
          createdAt: new Date(),
          id: 2,
          message: 'test response'
        }
      ],
      workspace: {
        id: 1,
        goal: 'test goal',
        bucket_folder: 'test-folder',
        agents: [
          {
            id: 2,
            name: 'test agent',
            capabilities_description: 'test capabilities'
          }
        ]
      },
      integrations: [
        {
          id: 3,
          connection_id: 'test-connection',
          provider_config_key: 'test-provider',
          provider: 'test',
          created: '2024-01-01',
          metadata: { key: 'value' },
          scopes: ['read', 'write'],
          openAPI: {
            title: 'Test API',
            description: 'Test API description'
          }
        }
      ],
      memories: [
        {
          id: 4,
          memory: 'test memory',
          createdAt: new Date('2024-01-01')
        }
      ]
    }

    const result = respondChatMessageActionSchema.parse(action)
    assert.deepStrictEqual(result, action)
  })
})
