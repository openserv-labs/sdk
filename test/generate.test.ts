import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import type { AxiosInstance } from 'axios'
import { Agent } from '../src/agent'
import type { ActionSchema } from '../src/types'

// Test subclass that allows mocking the runtimeClient
class TestAgent extends Agent {
  public set testRuntimeClient(client: AxiosInstance) {
    this.runtimeClient = client
  }
}

// A minimal valid action for billing context
const mockAction: ActionSchema = {
  type: 'do-task',
  workspace: {
    id: 1,
    goal: 'Test workspace',
    bucket_folder: 'test',
    agents: [{ name: 'Test Agent', id: 1, capabilities_description: 'Test' }]
  },
  me: {
    id: 1,
    name: 'Test Agent',
    kind: 'external' as const,
    isBuiltByAgentBuilder: false as const
  },
  task: {
    id: 1,
    description: 'test task',
    dependencies: [],
    humanAssistanceRequests: []
  },
  integrations: [],
  memories: []
}

describe('Agent.generate()', () => {
  let agent: TestAgent
  let lastPostCall: { url: string; data: unknown } | null

  beforeEach(() => {
    lastPostCall = null

    agent = new TestAgent({
      apiKey: 'test-key',
      systemPrompt: 'Test agent'
    })

    // Mock the runtimeClient
    agent.testRuntimeClient = {
      post: async (url: string, data: unknown) => {
        lastPostCall = { url, data }
        // Return mock response based on whether outputSchema was provided
        const body = data as Record<string, unknown>
        if (body.outputSchema) {
          return { data: { object: { sentiment: 'positive', confidence: 0.95 } } }
        }
        return { data: { text: 'Generated text response' } }
      }
    } as unknown as AxiosInstance
  })

  test('should generate text with just a prompt', async () => {
    const result = await agent.generate({
      prompt: 'Write a haiku about spring',
      action: mockAction
    })

    assert.strictEqual(result, 'Generated text response')
    assert.ok(lastPostCall, 'Should have made a POST call')
    assert.strictEqual(lastPostCall.url, '/generate')

    const body = lastPostCall.data as Record<string, unknown>
    assert.strictEqual(body.prompt, 'Write a haiku about spring')
    assert.strictEqual(body.action, mockAction)
    assert.strictEqual(body.messages, undefined, 'messages should not be sent when not provided')
    assert.strictEqual(
      body.outputSchema,
      undefined,
      'outputSchema should not be sent when not provided'
    )
  })

  test('should generate text with prompt and messages', async () => {
    const messages = [
      { role: 'system' as const, content: 'You are a poet.' },
      { role: 'user' as const, content: 'I like haikus.' },
      { role: 'assistant' as const, content: 'I can write haikus for you!' }
    ]

    const result = await agent.generate({
      prompt: 'Write a haiku about spring',
      messages,
      action: mockAction
    })

    assert.strictEqual(result, 'Generated text response')
    assert.ok(lastPostCall)

    const body = lastPostCall.data as Record<string, unknown>
    assert.strictEqual(body.prompt, 'Write a haiku about spring')
    assert.deepStrictEqual(body.messages, messages)
    assert.strictEqual(body.action, mockAction)
    assert.strictEqual(body.outputSchema, undefined)
  })

  test('should generate structured output with outputSchema', async () => {
    const outputSchema = z.object({
      sentiment: z.enum(['positive', 'negative', 'neutral']),
      confidence: z.number()
    })

    const result = await agent.generate({
      prompt: 'Analyze: I love sunny days!',
      outputSchema,
      action: mockAction
    })

    assert.deepStrictEqual(result, { sentiment: 'positive', confidence: 0.95 })
    assert.ok(lastPostCall)

    const body = lastPostCall.data as Record<string, unknown>
    assert.strictEqual(body.prompt, 'Analyze: I love sunny days!')
    assert.ok(body.outputSchema, 'outputSchema should be sent as JSON schema')
    assert.strictEqual(body.action, mockAction)
    assert.strictEqual(body.messages, undefined)
  })

  test('should generate structured output with messages and outputSchema', async () => {
    const messages = [
      { role: 'user' as const, content: 'How are you feeling today?' },
      { role: 'assistant' as const, content: 'I feel great, thanks!' }
    ]

    const outputSchema = z.object({
      sentiment: z.enum(['positive', 'negative', 'neutral']),
      confidence: z.number()
    })

    const result = await agent.generate({
      prompt: 'Analyze the sentiment of the conversation.',
      messages,
      outputSchema,
      action: mockAction
    })

    assert.deepStrictEqual(result, { sentiment: 'positive', confidence: 0.95 })
    assert.ok(lastPostCall)

    const body = lastPostCall.data as Record<string, unknown>
    assert.strictEqual(body.prompt, 'Analyze the sentiment of the conversation.')
    assert.deepStrictEqual(body.messages, messages)
    assert.ok(body.outputSchema)
    assert.strictEqual(body.action, mockAction)
  })

  test('should validate structured output against the schema', async () => {
    const strictSchema = z.object({
      score: z.number().min(0).max(100)
    })

    // Mock returns data that doesn't match the strict schema
    agent.testRuntimeClient = {
      post: async () => {
        return { data: { object: { score: 'not a number' } } }
      }
    } as unknown as AxiosInstance

    await assert.rejects(
      () =>
        agent.generate({
          prompt: 'Score this.',
          outputSchema: strictSchema,
          action: mockAction
        }),
      (error: unknown) => {
        assert.ok(
          error instanceof z.ZodError,
          'Should throw ZodError for schema validation failure'
        )
        return true
      }
    )
  })

  test('should send empty messages array correctly', async () => {
    const result = await agent.generate({
      prompt: 'Hello',
      messages: [],
      action: mockAction
    })

    assert.strictEqual(result, 'Generated text response')
    assert.ok(lastPostCall)

    // Empty array should still be sent (truthy)
    // Actually, empty array is truthy in JS, so it will be included
    const body = lastPostCall.data as Record<string, unknown>
    assert.deepStrictEqual(body.messages, [])
  })

  test('should pass through complex message types', async () => {
    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'What is 2+2?' },
      { role: 'assistant' as const, content: '4' },
      { role: 'user' as const, content: 'And 3+3?' }
    ]

    await agent.generate({
      prompt: 'Continue the conversation.',
      messages,
      action: mockAction
    })

    assert.ok(lastPostCall)
    const body = lastPostCall.data as Record<string, unknown>
    const sentMessages = body.messages as Array<{ role: string; content: string }>
    assert.strictEqual(sentMessages.length, 4)
    assert.strictEqual(sentMessages[0].role, 'system')
    assert.strictEqual(sentMessages[3].content, 'And 3+3?')
  })

  test('should handle runtime client errors gracefully', async () => {
    agent.testRuntimeClient = {
      post: async () => {
        throw new Error('Runtime service unavailable')
      }
    } as unknown as AxiosInstance

    await assert.rejects(
      () =>
        agent.generate({
          prompt: 'Hello',
          action: mockAction
        }),
      { message: 'Runtime service unavailable' }
    )
  })

  test('should throw when runtime returns no text', async () => {
    agent.testRuntimeClient = {
      post: async () => {
        return { data: {} } // no text field
      }
    } as unknown as AxiosInstance

    await assert.rejects(
      () =>
        agent.generate({
          prompt: 'Hello',
          action: mockAction
        }),
      { message: 'Runtime returned no text for generate()' }
    )
  })

  test('should throw when runtime returns null object for structured output', async () => {
    agent.testRuntimeClient = {
      post: async () => {
        return { data: { object: null } }
      }
    } as unknown as AxiosInstance

    await assert.rejects(
      () =>
        agent.generate({
          prompt: 'Analyze',
          outputSchema: z.object({ sentiment: z.string() }),
          action: mockAction
        }),
      { message: 'Runtime returned no structured output for generate() with outputSchema' }
    )
  })

  test('should convert outputSchema to JSON schema format', async () => {
    const outputSchema = z.object({
      title: z.string(),
      tags: z.array(z.string()),
      rating: z.number().min(1).max(5)
    })

    // Override mock to return data matching this specific schema
    agent.testRuntimeClient = {
      post: async (url: string, data: unknown) => {
        lastPostCall = { url, data }
        return { data: { object: { title: 'Test', tags: ['a', 'b'], rating: 4 } } }
      }
    } as unknown as AxiosInstance

    await agent.generate({
      prompt: 'Generate metadata',
      outputSchema,
      action: mockAction
    })

    assert.ok(lastPostCall)
    const body = lastPostCall.data as Record<string, unknown>
    const jsonSchema = body.outputSchema as Record<string, unknown>

    // Should be converted to JSON schema (not Zod schema)
    assert.strictEqual(jsonSchema.type, 'object')
    assert.ok(jsonSchema.properties, 'Should have properties')
    const props = jsonSchema.properties as Record<string, unknown>
    assert.ok(props.title, 'Should have title property')
    assert.ok(props.tags, 'Should have tags property')
    assert.ok(props.rating, 'Should have rating property')
  })

  test('should work inside a capability run function via this binding', async () => {
    // This tests that generate() works when called as this.generate() inside a run function
    let generateResult: string | undefined

    agent.addCapability({
      name: 'test_generate_in_run',
      description: 'Test capability that uses generate()',
      inputSchema: z.object({ topic: z.string() }),
      async run({ args, action }) {
        // `this` should be the agent, so this.generate() should work
        const result = await this.generate({
          prompt: `Write about ${args.topic}`,
          action
        })
        generateResult = result
        return result
      }
    })

    // Execute the capability via handleToolRoute
    const result = await agent.handleToolRoute({
      params: { toolName: 'test_generate_in_run' },
      body: {
        args: { topic: 'spring' },
        action: mockAction
      }
    })

    assert.strictEqual(generateResult, 'Generated text response')
    assert.deepStrictEqual(result, { result: 'Generated text response' })

    // Verify the runtime call was made correctly
    assert.ok(lastPostCall)
    const body = lastPostCall.data as Record<string, unknown>
    assert.strictEqual(body.prompt, 'Write about spring')
  })

  test('should work with messages inside a capability run function', async () => {
    agent.addCapability({
      name: 'test_generate_with_messages',
      description: 'Test capability that uses generate() with messages',
      inputSchema: z.object({ question: z.string() }),
      async run({ args, action }, messages) {
        const result = await this.generate({
          prompt: args.question,
          messages,
          action
        })
        return result
      }
    })

    const conversationMessages = [
      { role: 'system' as const, content: 'You are helpful.' },
      { role: 'user' as const, content: 'Hi!' }
    ]

    await agent.handleToolRoute({
      params: { toolName: 'test_generate_with_messages' },
      body: {
        args: { question: 'What is the meaning of life?' },
        action: mockAction,
        messages: conversationMessages
      }
    })

    // Verify messages were passed through to generate()
    assert.ok(lastPostCall)
    const body = lastPostCall.data as Record<string, unknown>
    assert.strictEqual(body.prompt, 'What is the meaning of life?')
    assert.deepStrictEqual(body.messages, conversationMessages)
  })
})
