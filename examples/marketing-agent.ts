import dotenv from 'dotenv'
dotenv.config()

import { Agent } from '../src'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import OpenAI from 'openai'
import { logger } from '../src/logger'

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const COST_PER_TOKEN = 0.0003 // this is made up just to be an example

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const marketingManager = new Agent({
  systemPrompt: fs.readFileSync(path.join(__dirname, './system.md'), 'utf8'),
  apiKey: process.env.OPENSERV_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY
})

marketingManager
  .addCapabilities([
    {
      name: 'createSocialMediaPost',
      description: 'Creates a social media post for the specified platform',
      schema: z.object({
        platform: z.enum(['twitter', 'linkedin', 'facebook']),
        topic: z.string()
      }),
      async run({ action, args }) {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are a marketing expert. Create a compelling ${args.platform} post about: ${args.topic}

Follow these platform-specific guidelines:
- Twitter: Max 280 characters, casual tone, use hashtags
- LinkedIn: Professional tone, industry insights, call to action
- Facebook: Engaging, conversational, can be longer

Include emojis where appropriate. Focus on driving engagement.

Only generate post for the given platform. Don't generate posts for other platforms.

Save the post in markdown format as a file and attach it to the task.
`
            },
            {
              role: 'user',
              content: args.topic
            }
          ]
        })

        const generatedPost = completion.choices[0].message.content
        logger.info(`Generated ${args.platform} post: ${generatedPost}`)

        if (action) {
          const isTaskAction = action.type === 'do-task'
          const workspaceId = action.workspace.id
          const outputTokens = completion.usage?.total_tokens || 0
          const cost = outputTokens * COST_PER_TOKEN

          await marketingManager.createUsageRecord({
            triggerType: isTaskAction ? 'task' : 'chat',
            workspaceId,
            taskId: isTaskAction ? action.task.id : undefined,
            cost
          })
        }

        return generatedPost || 'Failed to generate post'
      }
    },
    {
      name: 'analyzeEngagement',
      description: 'Analyzes social media engagement metrics and provides recommendations',
      schema: z.object({
        platform: z.enum(['twitter', 'linkedin', 'facebook']),
        metrics: z.object({
          likes: z.number(),
          shares: z.number(),
          comments: z.number(),
          impressions: z.number()
        })
      }),
      async run({ args }) {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are a social media analytics expert. Analyze the engagement metrics and provide actionable recommendations.

Consider platform-specific benchmarks:
- Twitter: Engagement rate = (likes + shares + comments) / impressions
- LinkedIn: Engagement rate = (likes + shares + comments) / impressions * 100
- Facebook: Engagement rate = (likes + shares + comments) / impressions * 100

Provide:
1. Current engagement rate
2. Performance assessment (below average, average, above average)
3. Top 3 actionable recommendations to improve engagement
4. Key metrics to focus on for improvement`
            },
            {
              role: 'user',
              content: JSON.stringify(args)
            }
          ]
        })

        const analysis = completion.choices[0].message.content
        logger.info(`Generated engagement analysis for ${args.platform}: ${analysis}`)

        return analysis || 'Failed to analyze engagement'
      }
    }
  ])
  .start()
  .catch(console.error)
