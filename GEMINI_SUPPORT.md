# Gemini Support

This PR adds support for Google's Gemini models as an alternative to OpenAI in the OpenServ Agent SDK.

## Usage

```javascript
const { Agent } = require('openserv-agent-sdk');

// Create an agent with Gemini
const agent = new Agent({
  apiKey: "YOUR_OPENSERV_API_KEY",
  systemPrompt: "You are a helpful assistant.",
  llmProvider: "gemini",
  llmApiKey: "YOUR_GEMINI_API_KEY",
  llmModel: "gemini-2.0-flash" // Optional, this is the default for Gemini
});

// The rest of your code remains the same
