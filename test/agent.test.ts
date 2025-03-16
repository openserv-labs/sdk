import { describe, test } from 'node:test'
import { Agent } from '../src'
import { z } from 'zod'
import assert from 'node:assert'
import { BadRequest as BadRequestError } from 'http-errors'

const mockApiKey = 'test-key'

// Create a test class that exposes protected/private members for testing
class TestAgent extends Agent {
  // Public accessors for testing
  public get testServer() {
    // @ts-expect-error Accessing private member for testing
    return this.server
  }

  public get testPort() {
    // @ts-expect-error Accessing private member for testing
    return this.port
  }

  public get testOpenAiTools() {
    // @ts-expect-error Accessing private member for testing
    return this.openAiTools
  }

  public testSetupRoutes() {
    // @ts-expect-error Accessing private member for testing
    this.setupRoutes()
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
      schema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    try {
      await agent.handleToolRoute({
        params: { toolName: 'testTool' },
        body: { args: { input: 123 } }
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

  test('should handle process request with OpenAI', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      llmApiKey: 'test-key'
    })

    agent.addCapability({
      name: 'testTool',
      description: 'A test tool',
      schema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    // Mock the LLM client
    Object.defineProperty(agent, '_llmClient', {
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

  test('should handle process request with Gemini', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      llmProvider: 'gemini',
      llmApiKey: 'test-key'
    })

    agent.addCapability({
      name: 'testTool',
      description: 'A test tool',
      schema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    // Mock the LLM client
    Object.defineProperty(agent, '_llmClient', {
      value: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Hello from Gemini',
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
    assert.strictEqual(response.choices[0].message.content, 'Hello from Gemini')
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

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async () => ({ data: { success: true } })
      },
      writable: true
    })

    const result = await agent.sendChatMessage({
      workspaceId: 1,
      agentId: 1,
      message: 'Test message'
    })
    assert.deepStrictEqual(result, { success: true })
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
      schema: z.object({
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

  test('should handle root route with invalid action', async () => {
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

    await agent.handleRootRoute({
      body: {
        type: 'invalid-action',
        me: {
          id: 1,
          name: 'test-agent',
          kind: 'external',
          isBuiltByAgentBuilder: false
        }
      }
    })

    assert.ok(handledError instanceof z.ZodError)
    const zodError = handledError as z.ZodError
    assert.ok(zodError.issues[0].message.includes('Invalid discriminator value'))
    assert.ok(zodError.issues[0].message.includes('do-task'))
    assert.ok(zodError.issues[0].message.includes('respond-chat-message'))
    assert.equal(handledContext?.context, 'handle_root_route')
  })
})

describe('Agent Initialization', () => {
  test('should throw error when API key is missing', () => {
    assert.throws(
      () => {
        new Agent({
          systemPrompt: 'You are a test agent'
        })
      },
      {
        message:
          'OpenServ API key is required. Please provide it in options or set OPENSERV_API_KEY environment variable.'
      }
    )
  })

  test('should use default port when not provided', () => {
    const agent = new TestAgent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })
    assert.strictEqual(agent.testPort, 7378) // Default port
  })
  
  test('should use default model based on provider', () => {
    const openaiAgent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })
    
    // @ts-expect-error Accessing private member for testing
    assert.strictEqual(openaiAgent.llmModel, 'gpt-4o')
    
    const geminiAgent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      llmProvider: 'gemini'
    })
    
    // @ts-expect-error Accessing private member for testing
    assert.strictEqual(geminiAgent.llmModel, 'gemini-2.0-flash')
  })
  
  test('should use custom model when provided', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      llmProvider: 'gemini',
      llmModel: 'gemini-1.5-pro'
    })
    
    // @ts-expect-error Accessing private member for testing
    assert.strictEqual(agent.llmModel, 'gemini-1.5-pro')
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
  test('should handle empty LLM response', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      llmApiKey: 'test-key'
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

    // Mock the LLM client with empty response
    Object.defineProperty(agent, '_llmClient', {
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
      assert.strictEqual(error.message, 'No response from openai')
    }
  })

  test('should handle empty Gemini response', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      llmProvider: 'gemini',
      llmApiKey: 'test-key'
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

    // Mock the LLM client with empty response
    Object.defineProperty(agent, '_llmClient', {
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
      assert.strictEqual(error.message, 'No response from gemini')
    }
  })

  test('should handle LLM response with tool calls', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      llmApiKey: 'test-key'
    })

    // Add a test tool
    agent.addCapability({
      name: 'testTool',
      description: 'A test tool',
      schema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    let callCount = 0
    // Mock the LLM client with tool calls followed by completion
    Object.defineProperty(agent, '_llmClient', {
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
      llmApiKey: 'test-key'
    })

    // Mock both LLM and runtime clients
    Object.defineProperty(agent, '_llmClient', {
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
      llmApiKey: 'test-key'
    })

    interface LLMClientMock {
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

    // Mock both LLM and runtime clients
    Object.defineProperty(agent, '_llmClient', {
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
      } as LLMClientMock,
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

    // Call setupRoutes again to test route registration
    agent.testSetupRoutes()

    // Verify routes were set up
    assert.ok(routes.some(r => r.path === '/health' && r.method === 'GET'))
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
      schema: z.object({
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
