import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, ChevronRight, CircleHelp } from "lucide-react"
import type { QuestionRequest } from "@remotty/protocol"

export function QuestionPanel({ requestInfo, request, onError }: { requestInfo: QuestionRequest; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  const [answers, setAnswers] = useState<string[][]>(() => requestInfo.questions.map(() => []))
  const [customAnswers, setCustomAnswers] = useState<string[]>(() => requestInfo.questions.map(() => ""))
  const [expanded, setExpanded] = useState(true)
  const [pending, setPending] = useState<"reply" | "reject">()
  const pendingRef = useRef(false)

  useEffect(() => {
    setAnswers(requestInfo.questions.map(() => []))
    setCustomAnswers(requestInfo.questions.map(() => ""))
    setExpanded(true)
    setPending(undefined)
    pendingRef.current = false
  }, [requestInfo.id])

  const toggle = (questionIndex: number, label: string, multiple?: boolean) => {
    setAnswers((current) => current.map((answer, index) => {
      if (index !== questionIndex) return answer
      if (!multiple) return [label]
      return answer.includes(label) ? answer.filter((item) => item !== label) : [...answer, label]
    }))
  }

  const submit = async () => {
    if (pendingRef.current) return
    if (answers.some((answer) => answer.length === 0)) {
      onError("Answer each question before you continue.")
      return
    }
    pendingRef.current = true
    setPending("reply")
    try {
      await request({ type: "question.reply", sessionId: requestInfo.targetSessionID ?? requestInfo.sessionID, questionId: requestInfo.id, answers })
    } catch (error) {
      setPending(undefined)
      pendingRef.current = false
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  const reject = async () => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending("reject")
    try {
      await request({ type: "question.reject", sessionId: requestInfo.targetSessionID ?? requestInfo.sessionID, questionId: requestInfo.id })
    } catch (error) {
      setPending(undefined)
      pendingRef.current = false
      onError(error instanceof Error ? error.message : String(error))
    }
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
                  aria-pressed={answers[questionIndex]?.includes(option.label)}
                  disabled={Boolean(pending)}
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
                value={customAnswers[questionIndex] ?? ""}
                disabled={Boolean(pending)}
                onChange={(event) => {
                  const value = event.target.value
                  setCustomAnswers((current) => current.map((answer, index) => index === questionIndex ? value : answer))
                  setAnswers((current) => current.map((answer, index) => index === questionIndex ? (value ? [value] : []) : answer))
                }}
              />
            )}
          </div>
        ))}
        <div className="question-actions">
          <button disabled={Boolean(pending)} onClick={() => void reject()}>Dismiss</button>
          <button className="confirm" disabled={Boolean(pending)} onClick={() => void submit()}>Continue <ChevronRight size={16} /></button>
        </div>
      </>}
    </section>
  )
}
