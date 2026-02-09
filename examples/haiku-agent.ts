import dotenv from 'dotenv'
dotenv.config()

import { Agent, run } from '../src'

const agent = new Agent({
  systemPrompt: 'You are a haiku poet. Generate haikus when asked.'
})

agent.addCapability({
  name: 'generate_haiku',
  description:
    'Generate a haiku poem (5-7-5 syllables) about the given input. Only output the haiku, nothing else.'
})

run(agent).catch(err => {
  console.error('Failed to start agent:', err)
  process.exit(1)
})
