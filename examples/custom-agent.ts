import dotenv from 'dotenv'
dotenv.config()

import { Agent } from '../src'
import type { z } from 'zod'
import type { respondChatMessageActionSchema } from '../src/types'

export class SophisticatedChatAgent extends Agent {
  protected async respondToChat(action: z.infer<typeof respondChatMessageActionSchema>) {
    this.sendChatMessage({
      workspaceId: action.workspace.id,
      agentId: action.me.id,
      message: 'This is a custom message',
      workspaceUpdateToken: action.workspaceUpdateToken
    })
  }
}

const agent = new SophisticatedChatAgent({
  systemPrompt: 'You are a helpful assistant.'
})

agent.start()
