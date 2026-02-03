import dotenv from 'dotenv'
dotenv.config()

import { z } from 'zod'
import OpenAI from 'openai'
import { Agent, run } from '../src'

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const agent = new Agent({
  systemPrompt: 'You are a haiku poet. Generate haikus when asked.'
})

agent.addCapability({
  name: 'generate_haiku',
  description: 'Generate a haiku poem about a given topic',
  schema: z.object({
    topic: z.string().describe('The topic or theme for the haiku')
  }),
  async run({ args }) {
    console.log('Generating haiku about', args.topic)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a haiku poet. Write a haiku (5-7-5 syllables) about the given topic. Only output the haiku, nothing else.'
        },
        {
          role: 'user',
          content: args.topic
        }
      ]
    })

    return completion.choices[0].message.content || 'Failed to generate haiku'
  }
})

run(agent).catch(err => {
  console.error('Failed to start agent:', err)
  process.exit(1)
})
