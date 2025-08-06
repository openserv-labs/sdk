import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { Agent } from '../src/agent'
import type OpenAI from 'openai'
import { BadRequest as BadRequestError } from 'http-errors'
import type { DoTaskActionSchema, RespondChatMessageActionSchema } from '../src/types'

// Create a test class that exposes protected methods for testing
class TestAgent extends Agent {
  public async testDoTask(action: DoTaskActionSchema) {
    return this.doTask(action)
  }

  public async testRespondToChat(action: RespondChatMessageActionSchema) {
    return this.respondToChat(action)
  }

  public set testOpenAI(client: OpenAI) {
    this._openai = client
  }
}

describe('Agent API Methods', () => {
  const mockApiKey = 'test-openserv-key'

  test('should have all required API methods', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const requiredMethods = [
      'uploadFile',
      'updateTaskStatus',
      'completeTask',
      'markTaskAsErrored',
      'addLogToTask',
      'requestHumanAssistance',
      'sendChatMessage',
      'createTask',
      'getTaskDetail',
      'getAgents',
      'getTasks',
      'getFiles',
      'process',
      'start',
      'addCapability',
      'addCapabilities'
    ]

    for (const method of requiredMethods) {
      assert.ok(typeof agent[method] === 'function', `${method} should be a function`)
    }
  })

  test('should make process method available when openaiApiKey is provided', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      openaiApiKey: 'test-openai-key'
    })

    assert.ok(typeof agent.process === 'function')
  })

  test('should throw error when process is called without OpenAI API key', async () => {
    // Save original env var
    const originalApiKey = process.env.OPENAI_API_KEY
    // Clear env var for test
    // Using delete here despite the linter warning because it's the only way to properly remove an environment variable
    // The performance impact is not a concern in tests

    // biome-ignore lint/performance/noDelete: This is a test, fgs.
    delete process.env.OPENAI_API_KEY

    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    try {
      await assert.rejects(
        () => agent.process({ messages: [{ role: 'user', content: 'test message' }] }),
        {
          message:
            'OpenAI API key is required for process(). Please provide it in options or set OPENAI_API_KEY environment variable.'
        }
      )
    } finally {
      // Restore original env var
      if (originalApiKey !== undefined) {
        process.env.OPENAI_API_KEY = originalApiKey
      }
    }
  })

  test('should have start method available', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    assert.ok(typeof agent.start === 'function')
  })

  test('should use custom error handler when provided', async () => {
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
        params: { toolName: 'nonexistent' },
        body: {}
      })
      assert.fail('Expected error to be thrown')
    } catch (error) {
      assert.ok(error instanceof BadRequestError)
      assert.ok(handledError instanceof Error)
      assert.equal(handledContext?.context, 'handle_tool_route')
    }
  })

  test('should handle errors in process method', async () => {
    let handledError: Error | undefined
    let handledContext: Record<string, unknown> | undefined

    const agent = new TestAgent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      openaiApiKey: 'test-key',
      onError: (error, context) => {
        handledError = error
        handledContext = context
      }
    })

    // Mock OpenAI to throw an error
    agent.testOpenAI = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('OpenAI error')
          }
        }
      }
    } as unknown as OpenAI

    try {
      await agent.process({ messages: [{ role: 'user', content: 'test' }] })
    } catch (error) {
      // Expected error
    }

    assert.ok(handledError instanceof Error)
    assert.equal(handledError?.message, 'OpenAI error')
    assert.equal(handledContext?.context, 'process')
  })

  test('should handle errors in doTask method', async () => {
    let handledError: Error | undefined
    let handledContext: Record<string, unknown> | undefined

    const agent = new TestAgent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      onError: (error, context) => {
        handledError = error
        handledContext = context
      }
    })

    const testAction = {
      type: 'do-task' as const,
      workspace: {
        id: 1,
        goal: 'Test workspace',
        bucket_folder: 'test',
        agents: [
          {
            name: 'Test Agent',
            id: 1,
            capabilities_description: 'Test capabilities'
          }
        ]
      },
      me: {
        id: 1,
        name: 'Test Agent',
        kind: 'external' as const,
        isBuiltByAgentBuilder: false as const
      } satisfies { name: string; id: number; kind: 'external'; isBuiltByAgentBuilder: false },
      task: {
        id: 1,
        description: 'test task',
        dependencies: [
          {
            id: 2,
            status: 'done' as const,
            description: 'dependency task',
            attachments: [],
            output: 'test output'
          }
        ],
        humanAssistanceRequests: [],
        attachments: []
      },
      integrations: [],
      memories: []
    }

    await agent.testDoTask(testAction)

    assert.ok(handledError instanceof Error)
    assert.equal(handledContext?.context, 'do_task')
    assert.deepEqual(handledContext?.action, testAction)
  })

  test('should handle errors in respondToChat method', async () => {
    let handledError: Error | undefined
    let handledContext: Record<string, unknown> | undefined

    const agent = new TestAgent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent',
      onError: (error, context) => {
        handledError = error
        handledContext = context
      }
    })

    const testAction = {
      type: 'respond-chat-message' as const,
      workspace: {
        id: 1,
        goal: 'Test workspace',
        bucket_folder: 'test',
        agents: [
          {
            name: 'Test Agent',
            id: 1,
            capabilities_description: 'Test capabilities'
          }
        ]
      },
      me: {
        id: 1,
        name: 'Test Agent',
        kind: 'external' as const,
        isBuiltByAgentBuilder: false as const
      } satisfies { name: string; id: number; kind: 'external'; isBuiltByAgentBuilder: false },
      integrations: [],
      memories: [],
      messages: []
    }

    await agent.testRespondToChat(testAction)

    assert.ok(handledError instanceof Error)
    assert.equal(handledContext?.context, 'respond_to_chat')
    assert.deepEqual(handledContext?.action, testAction)
  })
})
