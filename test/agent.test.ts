import { describe, test } from 'node:test'
import { Agent } from '../src'
import { z } from 'zod'
import assert from 'node:assert'
import { BadRequest as BadRequestError } from 'http-errors'

const mockApiKey = 'test-key'

describe('Agent', () => {
  test('should handle tool route validation error', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    agent.addCapability({
      name: 'testTool',
      description: 'A test tool',
      schema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    const req = {
      params: { toolName: 'testTool' },
      body: { args: { input: 123 } }
    }

    try {
      await agent.handleToolRoute(req)
      assert.fail('Expected validation error')
    } catch (error) {
      assert.ok(error instanceof Error)
      assert.ok(error.message.includes('Expected string, received number'))
    }
  })

  test('should handle tool route with missing tool', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    try {
      await agent.handleToolRoute({
        params: { toolName: 'nonexistentTool' },
        body: { args: {} }
      })
      assert.fail('Expected error')
    } catch (error) {
      assert.ok(error instanceof BadRequestError)
      assert.ok(error.message.includes('Tool "nonexistentTool" not found'))
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
      schema: z.object({
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
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      port: 0 // Use random available port
    })

    await agent.start()
    assert.ok(agent['server'], 'Server should be started')

    // Wait for server to fully stop
    await agent.stop()
    await new Promise(resolve => setTimeout(resolve, 100)) // Give time for cleanup
    assert.ok(!agent['server']?.listening, 'Server should not be listening')
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
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    try {
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
      assert.fail('Should throw error for invalid action')
    } catch (error) {
      assert.ok(error instanceof Error)
      // The error comes from Zod schema validation
      assert.ok(
        error.message.includes('Invalid discriminator value'),
        'Should have validation error message'
      )
    }
  })
})

describe('Agent Initialization', () => {
  test('should use default port when not provided', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })
    assert.strictEqual(agent['port'], 7378) // Default port
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
        post: async (url: string, data: any) => {
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

    const mockLog = {
      id: 1,
      severity: 'info',
      type: 'text',
      body: 'Test log'
    }

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        post: async (url: string, data: any) => {
          assert.strictEqual(data.severity, 'info')
          assert.strictEqual(data.type, 'text')
          assert.strictEqual(data.body, 'Test log')
          return { data: mockLog }
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
    assert.deepStrictEqual(log, mockLog)
  })

  test('should update task status', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const mockResponse = { success: true }

    // Mock the API client
    Object.defineProperty(agent, 'apiClient', {
      value: {
        put: async (url: string, data: any) => {
          assert.strictEqual(data.status, 'in-progress')
          return { data: mockResponse }
        }
      },
      writable: true
    })

    const response = await agent.updateTaskStatus({
      workspaceId: 1,
      taskId: 1,
      status: 'in-progress'
    })
    assert.deepStrictEqual(response, mockResponse)
  })
})

describe('Agent Process Methods', () => {
  test('should handle empty OpenAI response', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      openaiApiKey: 'test-key'
    })

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
      },
      writable: true
    })

    try {
      await agent.process({
        messages: [{ role: 'user', content: 'Hello' }]
      })
      assert.fail('Should throw error for empty response')
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
      schema: z.object({
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
              } else {
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
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Mock the router and app
    type RouteHandler = (...args: any[]) => void | Promise<void>
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

    Object.defineProperty(agent, 'app', {
      value: {
        use: (path: string | RouteHandler, router?: RouteHandler) => {
          // Simulate route registration
          if (typeof path === 'function') {
            router = path
            path = '/'
          }
          routes.push({ path: path as string, method: 'USE', handler: router! })
        }
      },
      writable: true
    })

    // Call setupRoutes again to test route registration
    agent['setupRoutes']()

    // Verify routes were set up
    assert.ok(routes.some(r => r.path === '/health' && r.method === 'GET'))
    assert.ok(routes.some(r => r.path === '/tools/:toolName' && r.method === 'POST'))
    assert.ok(routes.some(r => r.path === '/' && r.method === 'POST'))
  })

  test('should convert tools to OpenAI format', () => {
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
      run: async ({ args }) => args.input
    }

    agent.addCapability(testTool)

    const openAiTools = agent['openAiTools']
    assert.strictEqual(openAiTools.length, 1)
    assert.strictEqual(openAiTools[0].type, 'function')
    assert.strictEqual(openAiTools[0].function.name, 'testTool')
    assert.strictEqual(openAiTools[0].function.description, 'A test tool')
  })
})
