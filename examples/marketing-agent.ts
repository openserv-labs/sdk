import dotenv from 'dotenv'
dotenv.config()

import { Agent } from '../src'
import { config } from '../src/config.instance'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import OpenAI from 'openai'
import { logger } from '../src/logger'

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY
})

const marketingManager = new Agent({
  systemPrompt: fs.readFileSync(path.join(__dirname, './system.md'), 'utf8'),
  apiKey: config.OPENSERV_API_KEY,
  openaiApiKey: config.OPENAI_API_KEY
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
      async run({ args }) {
        const completion = await openai.chat.completions.create({
          model: config.OPENAI_MODEL,
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
          model: config.OPENAI_MODEL,
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
