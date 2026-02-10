import { describe, test } from 'node:test'
import { Agent } from '../src'
import { z } from 'zod'
import assert from 'node:assert'
import { BadRequest as BadRequestError } from 'http-errors'
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs'

const mockApiKey = 'test-key'

const minimalAction = {
  type: 'do-task' as const,
  me: { id: 1, name: 'test', kind: 'external' as const, isBuiltByAgentBuilder: false as const },
  task: { id: 1, description: '', dependencies: [], humanAssistanceRequests: [] },
  workspace: { id: 1, goal: '', bucket_folder: '', agents: [] },
  integrations: [],
  memories: []
}

// Create a test class that exposes protected/private members for testing
class TestAgent extends Agent {
  // Public accessors for testing
  public get testServer() {
    // @ts-expect-error Accessing private member for testing
    return this.server
  }

  public get testPort() {
    return this.port
  }

  public get testOpenAiTools() {
    // @ts-expect-error Accessing private member for testing
    return this.openAiTools
  }

  public testDefineRoutes() {
    // @ts-expect-error Accessing private member for testing
    this.defineRoutes()
  }
}

describe('Agent', () => {
  test('should handle tool route validation error', async () => {
    let handledError: Error | undefined
    let handledContext: Record<string, unknown> | undefined

    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      onError: (error, context) => {
        handledError = error
        handledContext = context
      }
    })

    agent.addCapability({
      name: 'testTool',
      description: 'A test tool',
      inputSchema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    try {
      await agent.handleToolRoute({
        params: { toolName: 'testTool' },
        body: { args: { input: 123 }, action: minimalAction }
      })
      assert.fail('Expected error to be thrown')
    } catch (error) {
      assert.ok(error instanceof z.ZodError)
      assert.ok(handledError instanceof z.ZodError)
      assert.ok(handledError.issues[0].message.includes('Expected string, received number'))
      assert.equal(handledContext?.context, 'handle_tool_route')
    }
  })

  test('should handle tool route with missing tool', async () => {
    let handledError: Error | undefined
    let handledContext: Record<string, unknown> | undefined

    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      onError: (error, context) => {
        handledError = error
        handledContext = context
      }
    })

    try {
      await agent.handleToolRoute({
        params: { toolName: 'nonexistentTool' },
        body: { args: {} }
      })
      assert.fail('Expected error to be thrown')
    } catch (error) {
      assert.ok(error instanceof BadRequestError)
      assert.ok(handledError instanceof BadRequestError)
      assert.equal(handledError.message, 'Tool "nonexistentTool" not found')
      assert.equal(handledContext?.context, 'handle_tool_route')
    }
  })

  test('should reject tool execution when action is missing', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    agent.addCapability({
      name: 'needsAction',
      description: 'Tool that needs action',
      inputSchema: z.object({}),
      run: async ({ action }) => `type: ${action.type}`
    })

    try {
      await agent.handleToolRoute({
        params: { toolName: 'needsAction' },
        body: { args: {} }
      })
      assert.fail('Expected error to be thrown')
    } catch (error) {
      assert.ok(error instanceof BadRequestError)
      assert.equal((error as InstanceType<typeof BadRequestError>).message, 'Action context is required for tool execution')
    }
  })

  test('should handle process request', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      openaiApiKey: 'test-key'
    })

    agent.addCapability({
      name: 'testTool',
      description: 'A test tool',
      inputSchema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    // Mock the OpenAI client
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Hello',
                    tool_calls: undefined
                  }
                }
              ]
            })
          }
        }
      },
      writable: true
    })

    const response = await agent.process({
      messages: [
        {
          role: 'user',
          content: 'Hello'
        }
      ]
    })

    assert.ok(response.choices[0].message)
  })

  test('should add system prompt when not present in messages', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a helpful assistant',
      openaiApiKey: 'test-key'
    })

    let capturedMessages: any[] = []
    // Mock the OpenAI client to capture messages
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async ({ messages }: { messages: any[] }) => {
              capturedMessages = messages
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: 'Response',
                      tool_calls: undefined
                    }
                  }
                ]
              }
            }
          }
        }
      },
      writable: true
    })

    await agent.process({
      messages: [{ role: 'user', content: 'Hello' }]
    })

    // Verify system prompt was added at the beginning
    assert.strictEqual(capturedMessages.length, 2)
    assert.strictEqual(capturedMessages[0].role, 'system')
    assert.strictEqual(capturedMessages[0].content, 'You are a helpful assistant')
    assert.strictEqual(capturedMessages[1].role, 'user')
    assert.strictEqual(capturedMessages[1].content, 'Hello')
  })

  test('should not duplicate system prompt when already present', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a helpful assistant',
      openaiApiKey: 'test-key'
    })

    let capturedMessages: any[] = []
    // Mock the OpenAI client to capture messages
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async ({ messages }: { messages: any[] }) => {
              capturedMessages = messages
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: 'Response',
                      tool_calls: undefined
                    }
                  }
                ]
              }
            }
          }
        }
      },
      writable: true
    })

    await agent.process({
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' }
      ]
    })

    // Verify system prompt was not duplicated
    assert.strictEqual(capturedMessages.length, 2)
    assert.strictEqual(capturedMessages[0].role, 'system')
    assert.strictEqual(capturedMessages[0].content, 'You are a helpful assistant')
    assert.strictEqual(capturedMessages[1].role, 'user')
    assert.strictEqual(capturedMessages[1].content, 'Hello')

    // Ensure there's only one system message with the prompt
    const systemMessages = capturedMessages.filter(
      m => m.role === 'system' && m.content === 'You are a helpful assistant'
    )
    assert.strictEqual(systemMessages.length, 1)
  })

  test('should add system prompt when different system message exists', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a helpful assistant',
      openaiApiKey: 'test-key'
    })

    let capturedMessages: any[] = []
    // Mock the OpenAI client to capture messages
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async ({ messages }: { messages: any[] }) => {
              capturedMessages = messages
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: 'Response',
                      tool_calls: undefined
                    }
                  }
                ]
              }
            }
          }
        }
      },
      writable: true
    })

    await agent.process({
      messages: [
        { role: 'system', content: 'Different system message' },
        { role: 'user', content: 'Hello' }
      ]
    })

    // Verify system prompt was added because content was different
    assert.strictEqual(capturedMessages.length, 3)
    assert.strictEqual(capturedMessages[0].role, 'system')
    assert.strictEqual(capturedMessages[0].content, 'You are a helpful assistant')
    assert.strictEqual(capturedMessages[1].role, 'system')
    assert.strictEqual(capturedMessages[1].content, 'Different system message')
    assert.strictEqual(capturedMessages[2].role, 'user')
    assert.strictEqual(capturedMessages[2].content, 'Hello')
  })

  test('should handle empty messages array', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a helpful assistant',
      openaiApiKey: 'test-key'
    })

    let capturedMessages: any[] = []
    // Mock the OpenAI client to capture messages
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async ({ messages }: { messages: any[] }) => {
              capturedMessages = messages
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: 'Response',
                      tool_calls: undefined
                    }
                  }
                ]
              }
            }
          }
        }
      },
      writable: true
    })

    await agent.process({
      messages: []
    })

    // Verify system prompt was added to empty array
    assert.strictEqual(capturedMessages.length, 1)
    assert.strictEqual(capturedMessages[0].role, 'system')
    assert.strictEqual(capturedMessages[0].content, 'You are a helpful assistant')
  })

  test('should preserve original messages array', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a helpful assistant',
      openaiApiKey: 'test-key'
    })

    // Mock the OpenAI client
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Response',
                    tool_calls: undefined
                  }
                }
              ]
            })
          }
        }
      },
      writable: true
    })

    const originalMessages: ChatCompletionMessageParam[] = [{ role: 'user', content: 'Hello' }]
    const messagesCopy = [...originalMessages]

    await agent.process({
      messages: originalMessages
    })

    // Verify original array was not modified
    assert.deepStrictEqual(originalMessages, messagesCopy)
    assert.strictEqual(originalMessages.length, 1)
  })

  test('should handle messages with complex content', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a helpful assistant',
      openaiApiKey: 'test-key'
    })

    let capturedMessages: any[] = []
    // Mock the OpenAI client to capture messages
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async ({ messages }: { messages: any[] }) => {
              capturedMessages = messages
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: 'Response',
                      tool_calls: undefined
                    }
                  }
                ]
              }
            }
          }
        }
      },
      writable: true
    })

    await agent.process({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ]
    })

    // Verify system prompt was added at the beginning
    assert.strictEqual(capturedMessages.length, 4)
    assert.strictEqual(capturedMessages[0].role, 'system')
    assert.strictEqual(capturedMessages[0].content, 'You are a helpful assistant')
  })

  test('should handle system prompt in middle of conversation', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a helpful assistant',
      openaiApiKey: 'test-key'
    })

    let capturedMessages: any[] = []
    // Mock the OpenAI client to capture messages
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async ({ messages }: { messages: any[] }) => {
              capturedMessages = messages
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: 'Response',
                      tool_calls: undefined
                    }
                  }
                ]
              }
            }
          }
        }
      },
      writable: true
    })

    await agent.process({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'How are you?' }
      ]
    })

    // Verify system prompt was not added because it already exists
    assert.strictEqual(capturedMessages.length, 3)
    // System prompt should remain in its original position
    assert.strictEqual(capturedMessages[1].role, 'system')
    assert.strictEqual(capturedMessages[1].content, 'You are a helpful assistant')
  })
})

describe('Agent API Methods', () => {
  test('should handle file operations', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        get: async () => ({ data: { files: [] } }),
        post: async () => ({ data: { fileId: 'test-file-id' } })
      },
      writable: true
    })

    const files = await agent.getFiles({ workspaceId: 1 })
    assert.deepStrictEqual(files, { files: [] })

    const uploadResult = await agent.uploadFile({
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content'
    })
    assert.deepStrictEqual(uploadResult, { fileId: 'test-file-id' })
  })

  test('should handle task operations', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Mock the API client with all required methods
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async () => ({ data: { success: true } }),
        get: async () => ({ data: { tasks: [] } }),
        put: async () => ({ data: { success: true } })
      },
      writable: true
    })

    const markErrored = await agent.markTaskAsErrored({
      workspaceId: 1,
      taskId: 1,
      error: 'Test error'
    })
    assert.deepStrictEqual(markErrored, { success: true })

    const complete = await agent.completeTask({
      workspaceId: 1,
      taskId: 1,
      output: 'Test result'
    })
    assert.deepStrictEqual(complete, { success: true })

    const tasks = await agent.getTasks({ workspaceId: 1 })
    assert.deepStrictEqual(tasks, { tasks: [] })
  })

  test('should handle chat operations', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockChatMessages = {
      agent: { id: 1, name: 'Calculator Agent' },
      messages: [
        {
          id: 398,
          author: 'user',
          message: 'What is the result of 2 + 2?',
          createdAt: '2025-04-22T12:10:49.595Z'
        },
        {
          id: 399,
          author: 'agent',
          message: 'The result is 4',
          createdAt: '2025-04-22T12:12:27.910Z'
        }
      ]
    }

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async () => ({ data: { success: true } }),
        get: async () => ({ data: mockChatMessages })
      },
      writable: true
    })

    const result = await agent.sendChatMessage({
      workspaceId: 1,
      agentId: 1,
      message: 'Test message'
    })
    assert.deepStrictEqual(result, { success: true })

    const messages = await agent.getChatMessages({
      workspaceId: 1,
      agentId: 1
    })
    assert.deepStrictEqual(messages, mockChatMessages)
  })

  test('should handle human assistance operations', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async () => ({ data: { success: true } })
      },
      writable: true
    })

    const result = await agent.requestHumanAssistance({
      workspaceId: 1,
      taskId: 1,
      type: 'text',
      question: 'Need help'
    })
    assert.deepStrictEqual(result, { success: true })
  })

  test('should handle server lifecycle', async () => {
    const agent = new TestAgent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      port: 0 // Use random available port
    })

    await agent.start()
    assert.ok(agent.testServer, 'Server should be started')

    // Wait for server to fully stop
    await agent.stop()
    await new Promise(resolve => setTimeout(resolve, 100)) // Give time for cleanup
    assert.ok(!agent.testServer?.listening, 'Server should not be listening')
  })

  test('should handle tool execution with action context', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const testTool = {
      name: 'testTool',
      description: 'A test tool',
      inputSchema: z.object({
        input: z.string()
      }),
      run: async ({ args, action }) => {
        assert.ok(action, 'Action context should be provided')
        return args.input
      }
    }

    agent.addCapability(testTool)

    const result = await agent.handleToolRoute({
      params: { toolName: 'testTool' },
      body: {
        args: { input: 'test' },
        action: {
          type: 'do-task',
          me: {
            id: 1,
            name: 'test-agent',
            kind: 'external',
            isBuiltByAgentBuilder: false
          },
          task: {
            id: 1,
            description: 'Test task',
            dependencies: [],
            humanAssistanceRequests: []
          },
          workspace: {
            id: 1,
            goal: 'Test goal',
            bucket_folder: 'test',
            agents: []
          },
          integrations: [],
          memories: []
        }
      }
    })

    assert.deepStrictEqual(result, { result: 'test' })
  })
})

describe('Agent Initialization', () => {
  test('should throw error when API key is missing on start()', async () => {
    // Agent construction should succeed without API key
    const agent = new Agent({
      systemPrompt: 'You are a test agent'
    })

    // start() should throw because API key is missing
    await assert.rejects(() => agent.start(), {
      message:
        'OpenServ API key is required. Please provide it in options, set OPENSERV_API_KEY environment variable, or call provision() first.'
    })
  })

  test('should use default port when not provided', () => {
    const agent = new TestAgent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })
    assert.strictEqual(agent.testPort, 7378) // Default port
  })
})

describe('Agent File Operations', () => {
  test('should handle file upload with all options', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async (url: string, data: FormData) => {
          // Verify FormData contents
          assert.ok(data.has('path'))
          assert.ok(data.has('taskIds'))
          assert.ok(data.has('skipSummarizer'))
          assert.ok(data.has('file'))
          return { data: { fileId: 'test-file-id' } }
        }
      },
      writable: true
    })

    const uploadResult = await agent.uploadFile({
      workspaceId: 1,
      path: 'test.txt',
      file: Buffer.from('test content'),
      taskIds: [1, 2],
      skipSummarizer: true
    })
    assert.deepStrictEqual(uploadResult, { fileId: 'test-file-id' })
  })

  test('should handle file upload with string content', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async (url: string, data: FormData) => {
          assert.ok(data.has('file'))
          return { data: { fileId: 'test-file-id' } }
        }
      },
      writable: true
    })

    const uploadResult = await agent.uploadFile({
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content'
    })
    assert.deepStrictEqual(uploadResult, { fileId: 'test-file-id' })
  })

  test('should handle file deletion', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        delete: async (url: string) => {
          assert.deepStrictEqual(url, '/workspaces/1/files/123')
          return { data: { message: 'File deleted successfully' } }
        }
      },
      writable: true
    })

    const deleteResult = await agent.deleteFile({
      workspaceId: 1,
      fileId: 123
    })
    assert.deepStrictEqual(deleteResult, { message: 'File deleted successfully' })
  })

  test('should get secrets collection', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockSecretCollection = [
      {
        id: 1,
        name: 'My secret'
      }
    ]

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        get: async () => ({ data: mockSecretCollection })
      },
      writable: true
    })

    const secretCollection = await agent.getSecrets({
      workspaceId: 1
    })
    assert.deepStrictEqual(secretCollection, mockSecretCollection)
  })

  test('should get revealed secret value', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockSecretRevealedalue = 'MyRevealedSecretValue'

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        get: async () => ({ data: mockSecretRevealedalue })
      },
      writable: true
    })

    const secretValue = await agent.getSecretValue({
      workspaceId: 1,
      secretId: 1
    })
    assert.deepStrictEqual(secretValue, mockSecretRevealedalue)
  })
})

describe('Agent Task Operations', () => {
  test('should get task details', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockTaskDetail = {
      id: 1,
      description: 'Test task',
      status: 'in-progress'
    }

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        get: async () => ({ data: mockTaskDetail })
      },
      writable: true
    })

    const taskDetail = await agent.getTaskDetail({
      workspaceId: 1,
      taskId: 1
    })
    assert.deepStrictEqual(taskDetail, mockTaskDetail)
  })

  test('should get agents in workspace', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockAgents = [
      {
        id: 1,
        name: 'Test Agent',
        capabilities_description: 'Test capabilities'
      }
    ]

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        get: async () => ({ data: mockAgents })
      },
      writable: true
    })

    const agents = await agent.getAgents({
      workspaceId: 1
    })
    assert.deepStrictEqual(agents, mockAgents)
  })
})

describe('Agent Task Management', () => {
  test('should create task with all options', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockTask = {
      id: 1,
      description: 'Test task',
      status: 'to-do'
    }

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async (
          url: string,
          data: {
            description: string
            body: string
            input: string
            expectedOutput: string
            dependencies: number[]
          }
        ) => {
          assert.strictEqual(data.description, 'Test task')
          assert.strictEqual(data.body, 'Task body')
          assert.strictEqual(data.input, 'Task input')
          assert.strictEqual(data.expectedOutput, 'Expected output')
          assert.deepStrictEqual(data.dependencies, [1, 2])
          return { data: mockTask }
        }
      },
      writable: true
    })

    const task = await agent.createTask({
      workspaceId: 1,
      assignee: 1,
      description: 'Test task',
      body: 'Task body',
      input: 'Task input',
      expectedOutput: 'Expected output',
      dependencies: [1, 2]
    })
    assert.deepStrictEqual(task, mockTask)
  })

  test('should add log to task', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    type LogData = {
      severity: string
      type: string
      body: string | Record<string, unknown>
    }

    type ApiData = Record<string, unknown>

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async (_url: string, data: ApiData) => {
          const typedData = data as LogData
          assert.strictEqual(typedData.severity, 'info')
          assert.strictEqual(typedData.type, 'text')
          assert.strictEqual(typedData.body, 'Test log')
          return { data: { id: 1, ...typedData } }
        }
      },
      writable: true
    })

    const log = await agent.addLogToTask({
      workspaceId: 1,
      taskId: 1,
      severity: 'info',
      type: 'text',
      body: 'Test log'
    })
    assert.deepStrictEqual(log, { id: 1, severity: 'info', type: 'text', body: 'Test log' })
  })

  test('should update task status', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    interface StatusData {
      status: string
    }

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        put: async (_url: string, data: StatusData) => {
          assert.strictEqual(data.status, 'in-progress')
          return { data: { success: true } }
        }
      },
      writable: true
    })

    const response = await agent.updateTaskStatus({
      workspaceId: 1,
      taskId: 1,
      status: 'in-progress'
    })
    assert.deepStrictEqual(response, { success: true })
  })
})

describe('Agent Process Methods', () => {
  test('should handle empty OpenAI response', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      openaiApiKey: 'test-key'
    })

    interface EmptyResponseMock {
      chat: {
        completions: {
          create: () => Promise<{
            choices: never[]
          }>
        }
      }
    }

    // Mock the OpenAI client with empty response
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async () => ({
              choices: []
            })
          }
        }
      } as EmptyResponseMock,
      writable: true
    })

    try {
      await agent.process({
        messages: [{ role: 'user', content: 'Hello' }]
      })
      throw new Error('Should have thrown error for empty response')
    } catch (error) {
      assert.ok(error instanceof Error)
      assert.strictEqual(error.message, 'No response from OpenAI')
    }
  })

  test('should handle OpenAI response with tool calls', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      openaiApiKey: 'test-key'
    })

    // Add a test tool
    agent.addCapability({
      name: 'testTool',
      description: 'A test tool',
      inputSchema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    let callCount = 0
    // Mock the OpenAI client with tool calls followed by completion
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async () => {
              callCount++
              if (callCount === 1) {
                return {
                  choices: [
                    {
                      message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                          {
                            id: 'call_1',
                            type: 'function',
                            function: {
                              name: 'testTool',
                              arguments: JSON.stringify({ input: 'test' })
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: 'Task completed',
                      tool_calls: undefined
                    }
                  }
                ]
              }
            }
          }
        }
      },
      writable: true
    })

    const response = await agent.process({
      messages: [{ role: 'user', content: 'Hello' }]
    })

    assert.ok(response.choices[0].message)
    assert.strictEqual(response.choices[0].message.content, 'Task completed')
  })
})

describe('Agent Action Handling', () => {
  test('should handle do-task action', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      openaiApiKey: 'test-key'
    })

    // Mock both OpenAI and runtime clients
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Task handled',
                    tool_calls: undefined
                  }
                }
              ]
            })
          }
        }
      },
      writable: true
    })

    Object.defineProperty(agent, 'runtimeClient', {
      value: {
        post: async () => ({ data: { success: true } })
      },
      writable: true
    })

    const action = {
      type: 'do-task' as const,
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external' as const,
        isBuiltByAgentBuilder: false
      },
      task: {
        id: 1,
        description: 'Test task',
        dependencies: [],
        humanAssistanceRequests: []
      },
      workspace: {
        id: 1,
        goal: 'Test goal',
        bucket_folder: 'test',
        agents: []
      },
      integrations: [],
      memories: []
    }

    await agent.handleRootRoute({ body: action })
  })

  test('should handle respond-chat-message action', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      openaiApiKey: 'test-key'
    })

    interface OpenAIClientMock {
      chat: {
        completions: {
          create: () => Promise<{
            choices: Array<{
              message: {
                role: string
                content: string
                tool_calls: undefined
              }
            }>
          }>
        }
      }
    }

    // Mock both OpenAI and runtime clients
    Object.defineProperty(agent, '_openai', {
      value: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Chat response',
                    tool_calls: undefined
                  }
                }
              ]
            })
          }
        }
      } as OpenAIClientMock,
      writable: true
    })

    Object.defineProperty(agent, 'runtimeClient', {
      value: {
        post: async () => ({ data: { success: true } })
      },
      writable: true
    })

    const action = {
      type: 'respond-chat-message' as const,
      me: {
        id: 1,
        name: 'test-agent',
        kind: 'external' as const,
        isBuiltByAgentBuilder: false
      },
      messages: [
        {
          author: 'user' as const,
          createdAt: new Date(),
          id: 1,
          message: 'Hello'
        }
      ],
      workspace: {
        id: 1,
        goal: 'Test goal',
        bucket_folder: 'test',
        agents: []
      },
      integrations: [],
      memories: []
    }

    await agent.handleRootRoute({ body: action })
  })
})

describe('Agent Route Setup', () => {
  test('should setup routes correctly', async () => {
    const agent = new TestAgent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Mock the router and app
    type RouteHandler = (
      req: { body?: Record<string, unknown>; params?: Record<string, string> },
      res: { status: (code: number) => { json: (data: unknown) => void } },
      next?: () => void
    ) => void | Promise<void>

    const routes: { path: string; method: string; handler: RouteHandler }[] = []
    const mockRouter = {
      get: (path: string, handler: RouteHandler) => {
        routes.push({ path, method: 'GET', handler })
      },
      post: (path: string, handler: RouteHandler) => {
        routes.push({ path, method: 'POST', handler })
      }
    }

    Object.defineProperty(agent, 'router', {
      value: mockRouter,
      writable: true
    })

    const addRoute = (path: string, method: string, handler: RouteHandler) => {
      routes.push({ path, method, handler })
    }

    Object.defineProperty(agent, 'app', {
      value: {
        use: (pathOrHandler: string | RouteHandler, maybeHandler?: RouteHandler) => {
          if (typeof pathOrHandler === 'string' && maybeHandler) {
            addRoute(pathOrHandler, 'USE', maybeHandler)
            return
          }
          if (typeof pathOrHandler === 'function') {
            addRoute('/', 'USE', pathOrHandler)
          }
        }
      },
      writable: true
    })

    // Call defineRoutes again to test route registration
    agent.testDefineRoutes()

    // Verify routes were set up (note: /health is registered on app in start(), not in defineRoutes())
    assert.ok(
      !routes.some(r => r.path === '/health' && r.method === 'GET'),
      '/health should NOT be on the router (it is registered on app before auth)'
    )
    assert.ok(routes.some(r => r.path === '/tools/:toolName' && r.method === 'POST'))
    assert.ok(routes.some(r => r.path === '/' && r.method === 'POST'))
  })

  test('should convert tools to OpenAI format', () => {
    const agent = new TestAgent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const testTool = {
      name: 'testTool',
      description: 'A test tool',
      inputSchema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    }

    agent.addCapability(testTool)

    const openAiTools = agent.testOpenAiTools
    assert.strictEqual(openAiTools.length, 1)
    assert.strictEqual(openAiTools[0].type, 'function')
    assert.strictEqual(openAiTools[0].function.name, 'testTool')
    assert.strictEqual(openAiTools[0].function.description, 'A test tool')
  })
})

describe('Agent Integration Operations', () => {
  test('should call integration endpoint successfully', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockResponse = {
      data: {
        output: {
          data: {
            text: 'Hello from integration!'
          }
        }
      }
    }

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async (url: string, data: unknown) => {
          assert.strictEqual(url, '/workspaces/1/integration/test-integration/proxy')
          assert.deepStrictEqual(data, {
            endpoint: '/test',
            method: 'POST',
            data: { message: 'test' }
          })
          return mockResponse
        }
      },
      writable: true
    })

    const response = await agent.callIntegration({
      workspaceId: 1,
      integrationId: 'test-integration',
      details: {
        endpoint: '/test',
        method: 'POST',
        data: { message: 'test' }
      }
    })

    assert.deepStrictEqual(response, mockResponse.data)
  })

  test('should handle integration call without data payload', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockResponse = {
      data: {
        output: {
          data: {
            status: 'success'
          }
        }
      }
    }

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async (url: string, data: unknown) => {
          assert.strictEqual(url, '/workspaces/1/integration/test-integration/proxy')
          assert.deepStrictEqual(data, {
            endpoint: '/test',
            method: 'GET'
          })
          return mockResponse
        }
      },
      writable: true
    })

    const response = await agent.callIntegration({
      workspaceId: 1,
      integrationId: 'test-integration',
      details: {
        endpoint: '/test',
        method: 'GET'
      }
    })

    assert.deepStrictEqual(response, mockResponse.data)
  })

  test('should handle integration call errors', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockError = new Error('Integration error')

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async () => {
          throw mockError
        }
      },
      writable: true
    })

    try {
      await agent.callIntegration({
        workspaceId: 1,
        integrationId: 'test-integration',
        details: {
          endpoint: '/test',
          method: 'GET'
        }
      })
      assert.fail('Expected error to be thrown')
    } catch (error) {
      assert.strictEqual(error, mockError)
    }
  })
})

describe('Agent MCP Integration', () => {
  interface MockMCPClient {
    serverId: string
    connect: () => Promise<void>
    getTools: () => Array<{
      name: string
      description?: string
      inputSchema?: Record<string, unknown>
    }>
    executeTool: (toolName: string, params: any) => Promise<any>
  }

  test('should initialize multiple MCP clients with different transport types', () => {
    const mcpServers = {
      'stdio-server': {
        transport: 'stdio' as const,
        command: 'python',
        args: ['-m', 'test_server'],
        autoRegisterTools: true
      },
      'sse-server': {
        transport: 'sse' as const,
        url: 'http://mock-openserv-mcp-server.local/api',
        autoRegisterTools: false
      },
      'http-server': {
        transport: 'http' as const,
        url: 'http://mock-openserv-mcp-server.local/api',
        autoRegisterTools: true
      }
    }

    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      mcpServers
    })

    assert.strictEqual(Object.keys(agent.mcpClients).length, 3)
    assert.ok(agent.mcpClients['stdio-server'])
    assert.ok(agent.mcpClients['sse-server'])
    assert.ok(agent.mcpClients['http-server'])
    assert.strictEqual(agent.mcpClients['stdio-server'].serverId, 'stdio-server')
    assert.strictEqual(agent.mcpClients['sse-server'].serverId, 'sse-server')
    assert.strictEqual(agent.mcpClients['http-server'].serverId, 'http-server')
  })

  test('should handle MCP server configuration validation errors with onError callback', () => {
    let handledError: Error | undefined
    let handledContext: Record<string, unknown> | undefined

    const invalidMcpServers = {
      'invalid-server': {
        transport: 'stdio' as const,
        command: '', // Invalid empty command
        args: []
      }
    }

    assert.throws(() => {
      new Agent({
        apiKey: mockApiKey,
        systemPrompt: 'You are a test agent',
        mcpServers: invalidMcpServers,
        onError: (error, context) => {
          handledError = error
          handledContext = context
        }
      })
    })

    assert.strictEqual(typeof handledError, 'undefined')
    assert.strictEqual(typeof handledContext, 'undefined')
  })

  test('should handle empty MCP server configuration', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      mcpServers: {}
    })

    assert.strictEqual(Object.keys(agent.mcpClients).length, 0)
  })

  test('should not auto-register tools when autoRegisterTools is false', async () => {
    const mcpServers = {
      'no-auto-server': {
        transport: 'stdio' as const,
        command: 'python',
        args: ['-m', 'server'],
        autoRegisterTools: false
      }
    }

    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      mcpServers
    })

    const mockTools = [
      {
        name: 'some_tool',
        description: 'Some tool',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          }
        }
      }
    ]

    const mockMcpClient: MockMCPClient = {
      serverId: 'no-auto-server',
      connect: async () => {},
      getTools: () => mockTools,
      executeTool: async () => {
        return { content: 'Should not be called' }
      }
    }

    agent.mcpClients['no-auto-server'] = mockMcpClient as any
    const mockServer = {
      listeners: {} as Record<string, ((...args: unknown[]) => void)[]>,
      on(event: string, handler: (...args: unknown[]) => void) {
        if (!this.listeners[event]) this.listeners[event] = []
        this.listeners[event].push(handler)
        // Emit 'listening' event asynchronously like real Node.js listen
        if (event === 'listening') {
          setImmediate(() => handler())
        }
      },
      removeListener(event: string, handler: (...args: unknown[]) => void) {
        if (this.listeners[event]) {
          this.listeners[event] = this.listeners[event].filter(h => h !== handler)
        }
      },
      close: (callback: () => void) => callback(),
      address: () => ({ port: 7378 })
    }

    Object.defineProperty(agent, 'app', {
      value: {
        use: () => {},
        get: () => {},
        listen: () => {
          return mockServer
        }
      },
      writable: true
    })

    await agent.start()

    const openAiTools = (agent as any).openAiTools
    const mcpToolNames = openAiTools
      .map((tool: any) => tool.function.name)
      .filter((name: string) => name.startsWith('mcp_no-auto-server_'))

    assert.strictEqual(mcpToolNames.length, 0)

    await agent.stop()
  })

  test('should execute MCP tool with action context', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockTools = [
      {
        name: 'context_tool',
        description: 'A tool that uses action context',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          },
          required: ['message']
        }
      }
    ]

    let toolExecuted = false
    let executedParams: any = null

    const mockMcpClient: MockMCPClient = {
      serverId: 'context-server',
      connect: async () => {},
      getTools: () => mockTools,
      executeTool: async (toolName: string, params: any) => {
        toolExecuted = true
        executedParams = params
        return { content: `Tool executed with message: ${params.message}` }
      }
    }

    agent.mcpClients['context-server'] = mockMcpClient as any
    ;(agent as any).addMCPToolsAsCapabilities('context-server', mockTools)

    const result = await agent.handleToolRoute({
      params: { toolName: 'mcp_context-server_context_tool' },
      body: {
        args: { message: 'Hello from context' },
        action: minimalAction
      }
    })

    assert.strictEqual(toolExecuted, true)
    assert.deepStrictEqual(executedParams, { message: 'Hello from context' })
    assert.strictEqual(result.result, 'Tool executed with message: Hello from context')
  })

  test('should handle multiple MCP servers with conflicting tool names', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockTools = [
      {
        name: 'shared_tool',
        description: 'A tool shared across servers',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          }
        }
      }
    ]

    const mockMcpClient1: MockMCPClient = {
      serverId: 'server-1',
      connect: async () => {},
      getTools: () => mockTools,
      executeTool: async (toolName: string, params: any) => {
        return { content: `Server 1: ${params.input}` }
      }
    }

    const mockMcpClient2: MockMCPClient = {
      serverId: 'server-2',
      connect: async () => {},
      getTools: () => mockTools,
      executeTool: async (toolName: string, params: any) => {
        return { content: `Server 2: ${params.input}` }
      }
    }

    agent.mcpClients['server-1'] = mockMcpClient1 as any
    agent.mcpClients['server-2'] = mockMcpClient2 as any
    ;(agent as any).addMCPToolsAsCapabilities('server-1', mockTools)
    ;(agent as any).addMCPToolsAsCapabilities('server-2', mockTools)

    const result1 = await agent.handleToolRoute({
      params: { toolName: 'mcp_server-1_shared_tool' },
      body: { args: { input: 'test1' }, action: minimalAction }
    })

    const result2 = await agent.handleToolRoute({
      params: { toolName: 'mcp_server-2_shared_tool' },
      body: { args: { input: 'test2' }, action: minimalAction }
    })

    assert.strictEqual(result1.result, 'Server 1: test1')
    assert.strictEqual(result2.result, 'Server 2: test2')
  })

  test('should handle MCP tool execution errors with onError callback', async () => {
    let handledError: Error | undefined
    let handledContext: Record<string, unknown> | undefined

    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      onError: (error, context) => {
        handledError = error
        handledContext = context
      }
    })

    const mockTools = [
      {
        name: 'failing_tool',
        description: 'A tool that fails',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          }
        }
      }
    ]

    const mockMcpClient: MockMCPClient = {
      serverId: 'error-server',
      connect: async () => {},
      getTools: () => mockTools,
      executeTool: async () => {
        throw new Error('Tool execution failed')
      }
    }

    agent.mcpClients['error-server'] = mockMcpClient as any
    ;(agent as any).addMCPToolsAsCapabilities('error-server', mockTools)

    try {
      await agent.handleToolRoute({
        params: { toolName: 'mcp_error-server_failing_tool' },
        body: {
          args: { input: 'test' },
          action: minimalAction
        }
      })
      assert.fail('Expected error to be thrown')
    } catch (error) {
      assert.ok(error instanceof Error)
      assert.ok(error.message.includes('Failed to execute MCP tool'))
      assert.ok(handledError)
      assert.strictEqual(handledContext?.context, 'handle_tool_route')
    }
  })

  test('should handle MCP tool schema validation errors', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockTools = [
      {
        name: 'strict_tool',
        description: 'A tool with strict validation',
        inputSchema: {
          type: 'object',
          properties: {
            required_field: { type: 'string' },
            number_field: { type: 'number' }
          },
          required: ['required_field']
        }
      }
    ]

    const mockMcpClient: MockMCPClient = {
      serverId: 'validation-server',
      connect: async () => {},
      getTools: () => mockTools,
      executeTool: async () => {
        return { content: 'Success' }
      }
    }

    agent.mcpClients['validation-server'] = mockMcpClient as any
    ;(agent as any).addMCPToolsAsCapabilities('validation-server', mockTools)

    try {
      await agent.handleToolRoute({
        params: { toolName: 'mcp_validation-server_strict_tool' },
        body: {
          args: { number_field: 42 },
          action: minimalAction
        }
      })
      assert.fail('Expected validation error to be thrown')
    } catch (error) {
      assert.ok(error instanceof Error)
    }

    const result = await agent.handleToolRoute({
      params: { toolName: 'mcp_validation-server_strict_tool' },
      body: {
        args: { required_field: 'test', number_field: 42 },
        action: minimalAction
      }
    })

    assert.strictEqual(result.result, 'Success')
  })
})
