import type { z } from 'zod'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { CapabilityFuncParams } from './types'
import type { Agent } from './agent'

export class Capability<M extends string, Schema extends z.ZodTypeAny> {
  public readonly inputSchema: Schema
  /** @deprecated Use `inputSchema` instead */
  public readonly schema: Schema

  constructor(
    public readonly name: string,
    public readonly description: string,
    inputSchema: Schema,
    public readonly run?: (
      this: Agent<M>,
      params: CapabilityFuncParams<Schema>,
      messages: ChatCompletionMessageParam[]
    ) => string | Promise<string>,
    public readonly outputSchema?: z.ZodTypeAny
  ) {
    this.inputSchema = inputSchema
    this.schema = inputSchema
  }
}
