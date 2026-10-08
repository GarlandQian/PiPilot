import { describe, expect, it } from 'vitest'
import { conversationTitleFromText } from '../../src/shared/conversation-title'

describe('conversation titles', () => {
  it('uses the first meaningful line without Markdown syntax', () => {
    const prompt = '# Continue Current Task\n\nResume work on the current task — pick up at the right phase/step in `.trellis/workflow.md`.\n\n---\n\n## Step 1: Load Current Context'
    expect(conversationTitleFromText(prompt)).toBe('Continue Current Task')
    expect(conversationTitleFromText('---\n\n> **Fix** the [login page](https://example.com) crash')).toBe('Fix the login page crash')
    expect(conversationTitleFromText('```ts\nconst a = 1\n```\n- [ ] Ship `v1.2` *today*')).toBe('Ship v1.2 today')
  })

  it('keeps identifiers intact and shortens long lines', () => {
    expect(conversationTitleFromText('Rename file_name to snake_case_name')).toBe('Rename file_name to snake_case_name')
    const long = conversationTitleFromText('Investigate why the background catalog refresh skips sessions after the window regains focus on macOS')
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(61)
    expect(long).not.toMatch(/\s…$/u)
    const cjk = conversationTitleFromText('请帮我检查一下这个项目里所有和会话目录刷新相关的代码，找出为什么窗口重新获得焦点之后后台刷新会跳过一部分会话的问题，并给出修复方案和回归测试')
    // No spaces to break at, so it is cut at the limit.
    expect(cjk).toHaveLength(61)
    expect(cjk.endsWith('…')).toBe(true)
  })

  it('reads past skill instructions to the user’s own words', () => {
    const envelope = '<skill name="review-helper" location="/skills/review/SKILL.md">\n## Skill instructions\n</skill>\n\nReview the **auth** module'
    expect(conversationTitleFromText(envelope)).toBe('Review the auth module')
    expect(conversationTitleFromText('<skill name="review-helper" location="/x">\nbody\n</skill>')).toBe('/review-helper')
    expect(conversationTitleFromText('  \n\n')).toBe('')
  })
})
