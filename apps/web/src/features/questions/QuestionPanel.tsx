import { useEffect, useState } from "react"
import { Check, ChevronDown, ChevronRight, CircleHelp } from "lucide-react"
import type { QuestionRequest } from "@remotty/protocol"

export function QuestionPanel({ requestInfo, request, onError }: { requestInfo: QuestionRequest; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  const [answers, setAnswers] = useState<string[][]>(() => requestInfo.questions.map(() => []))
  const [expanded, setExpanded] = useState(true)

  useEffect(() => setExpanded(true), [requestInfo.id])

  const toggle = (questionIndex: number, label: string, multiple?: boolean) => {
    setAnswers((current) => current.map((answer, index) => {
      if (index !== questionIndex) return answer
      if (!multiple) return [label]
      return answer.includes(label) ? answer.filter((item) => item !== label) : [...answer, label]
    }))
  }

  const submit = () => {
    if (answers.some((answer) => answer.length === 0)) {
      onError("Answer each question before you continue.")
      return
    }
    void request({ type: "question.reply", sessionId: requestInfo.targetSessionID ?? requestInfo.sessionID, questionId: requestInfo.id, answers }).catch((error) => onError(error.message))
  }

  return (
    <section className={`question-panel ${expanded ? "" : "collapsed"}`}>
      <button className="question-title" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><CircleHelp size={20} /><strong>Question</strong><ChevronDown size={18} /></button>
      {expanded && <>
        {requestInfo.questions.map((question, questionIndex) => (
          <div className="question-block" key={`${requestInfo.id}-${questionIndex}`}>
            <span>{question.header}</span>
            <p>{question.question}</p>
            <div className="option-list">
              {question.options.map((option) => (
                <button
                  className={answers[questionIndex]?.includes(option.label) ? "selected" : ""}
                  key={option.label}
                  title={option.description}
                  onClick={() => toggle(questionIndex, option.label, question.multiple)}
                >
                  {answers[questionIndex]?.includes(option.label) && <Check size={14} />}
                  {option.label}
                </button>
              ))}
            </div>
            {question.custom !== false && (
              <input
                aria-label={`Custom answer for ${question.header}`}
                placeholder="Type another answer"
                onChange={(event) => setAnswers((current) => current.map((answer, index) => index === questionIndex ? (event.target.value ? [event.target.value] : []) : answer))}
              />
            )}
          </div>
        ))}
        <div className="question-actions">
          <button onClick={() => void request({ type: "question.reject", sessionId: requestInfo.targetSessionID ?? requestInfo.sessionID, questionId: requestInfo.id }).catch((error) => onError(error.message))}>Dismiss</button>
          <button className="confirm" onClick={submit}>Continue <ChevronRight size={16} /></button>
        </div>
      </>}
    </section>
  )
}
