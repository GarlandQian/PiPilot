import * as React from 'react'

export interface QuestionBranchPoint { index: number; count: number; previous?: string; next?: string }

/**
 * What a question in the transcript can do with Pi's session tree: be edited
 * and asked again (a new branch from the same point), and show ‹ 1/2 › when
 * it already has edits. Provided by the app, read by each question.
 */
export interface QuestionBranches {
  points: ReadonlyMap<string, QuestionBranchPoint>
  busy: boolean
  edit(entryId: string): void
  switchTo(leafId: string): void
}

export const QuestionBranchesContext = React.createContext<QuestionBranches | null>(null)
