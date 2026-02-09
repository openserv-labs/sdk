import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { Agent, Capability } from '../src'

describe('Agent Capabilities', () => {
  const mockApiKey = 'test-openserv-key'

  test('should execute a capability function and return the expected output', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    agent.addCapability({
      name: 'testCapability',
      description: 'A test capability',
      inputSchema: z.object({
        input: z.string()
      }),
      run: async ({ args }) => args.input
    })

    const result = await agent.handleToolRoute({
      params: { toolName: 'testCapability' },
      body: { args: { input: 'test' } }
    })

    assert.deepStrictEqual(result, { result: 'test' })
  })

  test('should validate capability inputSchema', () => {
    const capability = new Capability(
      'testCapability',
      'A test capability',
      z.object({
        input: z.number()
      }),
      async ({ args }) => args.input.toString()
    )

    assert.throws(
      () => capability.inputSchema.parse({ input: 'not a number' }),
      err => err instanceof z.ZodError
    )
  })

  test('should support deprecated schema property', () => {
    const capability = new Capability(
      'testCapability',
      'A test capability',
      z.object({
        input: z.number()
      }),
      async ({ args }) => args.input.toString()
    )

    // schema and inputSchema should be the same object
    assert.strictEqual(capability.schema, capability.inputSchema)
  })

  test('should handle multiple capabilities', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const capabilities = [
      {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: z.object({ input: z.string() }),
        run: async ({ args }) => args.input
      },
      {
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: z.object({ input: z.string() }),
        run: async ({ args }) => args.input
      }
    ] as const

    agent.addCapabilities(capabilities)

    // Test that both tools are available by trying to execute them
    await Promise.all([
      agent
        .handleToolRoute({
          params: { toolName: 'tool1' },
          body: { args: { input: 'test1' } }
        })
        .then(result => assert.deepStrictEqual(result, { result: 'test1' })),
      agent
        .handleToolRoute({
          params: { toolName: 'tool2' },
          body: { args: { input: 'test2' } }
        })
        .then(result => assert.deepStrictEqual(result, { result: 'test2' }))
    ])
  })

  test('should throw error when adding duplicate capability', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    agent.addCapability({
      name: 'test',
      description: 'Tool 1',
      inputSchema: z.object({ input: z.string() }),
      run: async ({ args }) => args.input
    })

    assert.throws(
      () =>
        agent.addCapability({
          name: 'test',
          description: 'Tool 1 duplicate',
          inputSchema: z.object({ input: z.string() }),
          run: async ({ args }) => args.input
        }),
      {
        message: 'Tool with name "test" already exists'
      }
    )
  })

  test('should throw error when adding capabilities with duplicate names', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    const capabilities = [
      {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: z.object({ input: z.string() }),
        run: async ({ args }) => args.input
      },
      {
        name: 'tool1',
        description: 'Tool 1 duplicate',
        inputSchema: z.object({ input: z.string() }),
        run: async ({ args }) => args.input
      }
    ] as const

    assert.throws(() => agent.addCapabilities(capabilities), {
      message: 'Tool with name "tool1" already exists'
    })
  })

  test('should accept deprecated schema property in addCapability', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    agent.addCapability({
      name: 'legacyTool',
      description: 'A legacy capability using deprecated schema',
      schema: z.object({ input: z.string() }),
      run: async ({ args }) => args.input
    })

    const result = await agent.handleToolRoute({
      params: { toolName: 'legacyTool' },
      body: { args: { input: 'legacy' } }
    })

    assert.deepStrictEqual(result, { result: 'legacy' })
  })

  test('should throw when both inputSchema and schema are provided', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    assert.throws(
      () =>
        agent.addCapability({
          name: 'conflict',
          description: 'Conflicting schemas',
          inputSchema: z.object({ input: z.string() }),
          schema: z.object({ input: z.string() }),
          run: async ({ args }) => args.input
        } as any),
      {
        message:
          'Cannot provide both "inputSchema" and "schema". Use "inputSchema" ("schema" is deprecated).'
      }
    )
  })

  test('should throw when both run and outputSchema are provided', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    assert.throws(
      () =>
        agent.addCapability({
          name: 'conflict',
          description: 'Conflicting run and outputSchema',
          inputSchema: z.object({ input: z.string() }),
          run: async ({ args }) => args.input,
          outputSchema: z.object({ result: z.string() })
        } as any),
      {
        message:
          'Cannot provide both "run" and "outputSchema". "outputSchema" is only for run-less capabilities.'
      }
    )
  })

  test('should throw when runnable capability omits inputSchema', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    assert.throws(
      () =>
        agent.addCapability({
          name: 'noSchema',
          description: 'Missing schema',
          run: async () => 'result'
        } as any),
      {
        message:
          'Runnable capabilities require "inputSchema" (or deprecated "schema"). ' +
          'Only run-less capabilities can omit it.'
      }
    )
  })

  test('should allow run-less capability with no inputSchema (uses default)', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Should not throw
    agent.addCapability({
      name: 'runless',
      description: 'A run-less capability with default inputSchema'
    })
  })

  test('should allow run-less capability with custom inputSchema', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Should not throw
    agent.addCapability({
      name: 'runlessCustom',
      description: 'A run-less capability with custom inputSchema',
      inputSchema: z.object({
        topic: z.string(),
        style: z.string()
      })
    })
  })

  test('should allow run-less capability with outputSchema', () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    // Should not throw
    agent.addCapability({
      name: 'structured',
      description: 'A run-less capability with structured output',
      outputSchema: z.object({
        sentiment: z.enum(['positive', 'negative', 'neutral']),
        confidence: z.number()
      })
    })
  })

  test('should reject run-less tool via handleToolRoute', async () => {
    const agent = new Agent({
      apiKey: mockApiKey,
      systemPrompt: 'You are a test agent'
    })

    agent.addCapability({
      name: 'runlessTool',
      description: 'A run-less capability'
    })

    await assert.rejects(
      () =>
        agent.handleToolRoute({
          params: { toolName: 'runlessTool' },
          body: { args: { input: 'test' } }
        }),
      {
        message:
          'Tool "runlessTool" is a run-less capability handled by the runtime, not by this agent.'
      }
    )
  })
})
