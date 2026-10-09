import type { LocalizedText } from './model-provider-presets'

/*
 * Common MCP servers to start from. Commands follow each project's README;
 * the list started from cc-switch's MCP presets (MIT).
 */

export interface McpTemplate {
  key: string
  /** The server name suggested for mcp.json. */
  name: string
  title: LocalizedText
  description: LocalizedText
  definition: Readonly<Record<string, unknown>>
  docs: string
  /** Asks for something before it can work: folders to share, or a token. */
  needs?: 'folders' | 'token'
}

const text = (en: string, zh: string): LocalizedText => ({ en, zh })

export const MCP_TEMPLATES: readonly McpTemplate[] = [
  {
    key: 'context7', name: 'context7', title: text('Context7', 'Context7'),
    description: text('Up-to-date library documentation and code examples.', '最新的库文档和代码示例。'),
    definition: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
    docs: 'https://github.com/upstash/context7',
  },
  {
    key: 'playwright', name: 'playwright', title: text('Playwright', 'Playwright'),
    description: text('Drives a real browser: open pages, click, fill in forms, take screenshots.', '操作真实浏览器：打开网页、点击、填写表单、截图。'),
    definition: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    docs: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    key: 'fetch', name: 'fetch', title: text('Fetch', 'Fetch 网页抓取'),
    description: text('Fetches web pages and turns them into Markdown. Needs uv.', '抓取网页并转换为 Markdown。需要安装 uv。'),
    definition: { command: 'uvx', args: ['mcp-server-fetch'] },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    key: 'filesystem', name: 'filesystem', title: text('Filesystem', '文件系统'),
    description: text('Reads and writes files in the folders you choose.', '读写你指定的文件夹中的文件。'),
    definition: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    needs: 'folders',
  },
  {
    key: 'memory', name: 'memory', title: text('Memory', '记忆'),
    description: text('A knowledge graph the model can keep notes in across chats.', '模型可在多次会话间记录笔记的知识图谱。'),
    definition: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    key: 'sequential-thinking', name: 'sequential-thinking', title: text('Sequential Thinking', '逐步思考'),
    description: text('Helps the model work through a problem step by step.', '帮助模型一步步拆解问题。'),
    definition: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    key: 'time', name: 'time', title: text('Time', '时间'),
    description: text('Current time and time zone conversion. Needs uv.', '当前时间和时区换算。需要安装 uv。'),
    definition: { command: 'uvx', args: ['mcp-server-time'] },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
  },
  {
    key: 'github', name: 'github', title: text('GitHub', 'GitHub'),
    description: text('Issues, pull requests and code on GitHub, through GitHub’s hosted server.', '通过 GitHub 官方托管服务访问 Issue、PR 和代码。'),
    // The token stays out of the file: Pi reads it from the environment.
    definition: { url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' } },
    docs: 'https://github.com/github/github-mcp-server',
    needs: 'token',
  },
]

/** The template a configured server was made from, by its command and package or its address. */
export function templateForServer(definition: Readonly<Record<string, unknown>>) {
  return MCP_TEMPLATES.find((template) => {
    if (typeof template.definition.url === 'string') return definition.url === template.definition.url
    const args = Array.isArray(template.definition.args) ? template.definition.args : []
    const packageName = String(args.find((arg) => typeof arg === 'string' && !arg.startsWith('-')) ?? '').replace(/@latest$/u, '')
    return definition.command === template.definition.command && Array.isArray(definition.args) &&
      definition.args.some((arg) => typeof arg === 'string' && arg.replace(/@latest$/u, '') === packageName)
  }) ?? null
}
