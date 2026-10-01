import { describe, expect, it } from 'vitest'
import { parsePromptSkillEnvelope, promptDisplaySummary } from '../../src/renderer/pi-rpc/prompt-presentation'
import { createConversationPlanKickoff, parseConversationPlanKickoff } from '../../src/shared/conversation-task'

const name = 'review-helper'
const location = '/fixture/skills/review-helper/SKILL.md'
const content = 'References are relative to /fixture/skills/review-helper.\n\n## Instructions\n\n- **Inspect** the files.'
const envelope = `<skill name="${name}" location="${location}">\n${content}\n</skill>`

describe('prompt skill presentation', () => {
  it('recognizes the exact leading SDK envelope without needing a filesystem path', () => {
    expect(parsePromptSkillEnvelope(envelope)).toEqual({ name, location, content, userMessage: '' })
    expect(promptDisplaySummary(envelope)).toBe(name)
  })

  it('preserves skill instructions and the appended user message separately', () => {
    const userMessage = '**Review** this change.\n\nKeep `settings.json` intact.'
    const text = `${envelope}\n\n${userMessage}`

    expect(parsePromptSkillEnvelope(text)).toEqual({ name, location, content, userMessage })
    expect(promptDisplaySummary(text)).toBe(`${name} · ${userMessage}`)
  })

  it.each([
    ['ordinary prose', 'Review **this** change.'],
    ['prefixed example', `Example:\n\n${envelope}`],
    ['leading whitespace', ` ${envelope}`],
    ['blockquote example', envelope.split('\n').map((line) => `> ${line}`).join('\n')],
    ['fenced example', `\`\`\`xml\n${envelope}\n\`\`\``],
    ['inline quoted example', `\`${envelope}\``],
    ['additional attributes', envelope.replace('location=', 'extra="example" location=')],
    ['missing location', envelope.replace(` location="${location}"`, '')],
    ['reordered attributes', envelope.replace(`name="${name}" location="${location}"`, `location="${location}" name="${name}"`)],
    ['missing closing tag', envelope.replace('\n</skill>', '')],
    ['trailing text without the SDK separator', `${envelope}\nUser text`],
  ])('leaves a %s unchanged', (_label, text) => {
    expect(parsePromptSkillEnvelope(text)).toBeNull()
    expect(promptDisplaySummary(text)).toBe(text)
  })

  it.each([
    ['backticks', '```xml', '</skill>', '```'],
    ['tildes', '~~~xml', '</skill>', '~~~'],
    ['longer fence', '````markdown', '```\n</skill>\n```', '````'],
  ])('ignores a closing-like tag inside a %s fenced block', (_label, opening, example, closing) => {
    const skillContent = `## Examples\n\n${opening}\n${example}\n${closing}\n\nContinue **skill** instructions.`
    const userMessage = 'Then handle my **request**.'
    const text = `<skill name="${name}" location="${location}">\n${skillContent}\n</skill>\n\n${userMessage}`

    expect(parsePromptSkillEnvelope(text)).toEqual({ name, location, content: skillContent, userMessage })
  })
})
describe('plan kickoff presentation', () => {
  const plan = { id: 'plan-1', title: 'Build "feature"\nand verify' }
  const prompt = createConversationPlanKickoff(plan, '325bb64b-1779-4163-b44c-9179e8092a26')

  it('recognizes only the complete generated prompt and leaves runtime text unchanged', () => {
    expect(parseConversationPlanKickoff(prompt)).toEqual({ title: plan.title, planId: plan.id })
    expect(promptDisplaySummary(prompt, (title) => `继续：${title}`)).toBe(`继续：${plan.title}`)
    expect(promptDisplaySummary(prompt)).toBe(plan.title)
    expect(prompt).toContain('[PiPilot continuation 325bb64b-1779-4163-b44c-9179e8092a26]')
    for (const text of [`Quoted: ${prompt}`, `${prompt}\nDo something else`, prompt.replace('within its existing scope', 'outside its existing scope'), `\`\`\`\n${prompt}\n\`\`\``, prompt.replace('325bb64b-1779-4163-b44c-9179e8092a26', 'not-a-nonce')]) {
      expect(parseConversationPlanKickoff(text)).toBeNull()
      expect(promptDisplaySummary(text)).toBe(text)
    }
  })
})
