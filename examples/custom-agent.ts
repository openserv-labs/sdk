import dotenv from 'dotenv'
dotenv.config()

import { Agent } from '../src'
import type { RespondChatMessageActionSchema } from '../src/types'

export class SophisticatedChatAgent extends Agent {
  protected async respondToChat(action: RespondChatMessageActionSchema) {
    this.sendChatMessage({
      workspaceId: action.workspace.id,
      agentId: action.me.id,
      message: 'This is a custom message'
    })
  }
}

const agent = new SophisticatedChatAgent({
  systemPrompt: 'You are a helpful assistant.'
})

agent.start()
