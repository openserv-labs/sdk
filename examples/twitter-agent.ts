import dotenv from 'dotenv'
dotenv.config()

import { Agent } from '../src'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const marketingManager = new Agent({
  systemPrompt: fs.readFileSync(path.join(__dirname, './system.md'), 'utf8'),
  apiKey: process.env.OPENSERV_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY
})

marketingManager
  .addCapabilities([
    {
      name: 'getTwitterAccount',
      description: 'Gets the Twitter account for the current user',
      schema: z.object({}),
      async run({ action }) {
        const details = await this.callIntegration({
          workspaceId: action!.workspace.id,
          workspaceUpdateToken: action!.workspaceUpdateToken,
          integrationId: 'twitter-v2',
          details: {
            endpoint: '/2/users/me',
            method: 'GET'
          }
        })

        return details.output.data.username
      }
    },
    {
      name: 'sendMarketingTweet',
      description: 'Sends a marketing tweet to Twitter',
      schema: z.object({
        tweetText: z.string()
      }),
      async run({ args, action }) {
        const response = await this.callIntegration({
          workspaceId: action!.workspace.id,
          workspaceUpdateToken: action!.workspaceUpdateToken,
          integrationId: 'twitter-v2',
          details: {
            endpoint: '/2/tweets',
            method: 'POST',
            data: {
              text: args.tweetText
            }
          }
        })

        console.log(response.output)

        try {
          const error = JSON.parse(JSON.parse(response.output.message))

          return `Error ${error.status}: ${error.message}`
        } catch (e) {
          const output = response.output.data

          return output.text
        }
      }
    }
  ])
  .start()
  .catch(console.error)
