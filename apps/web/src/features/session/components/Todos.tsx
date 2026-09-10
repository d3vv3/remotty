import { Check, LoaderCircle, X } from "lucide-react"
import type { SessionTodo } from "../model/sessionContent"

export function Todos({ todos }: { todos: SessionTodo[] }) {
  return <div className="todo-list">
    {todos.map((todo) => <div className={`todo-row ${todo.status}`} key={todo.id}>
      <span className="todo-mark">{todo.status === "completed" ? <Check size={14} /> : todo.status === "in_progress" ? <LoaderCircle className="spin" size={14} /> : todo.status === "cancelled" ? <X size={14} /> : null}</span>
      <span>{todo.content}</span><small>{todo.priority}</small>
    </div>)}
    {todos.length === 0 && <div className="empty-state"><p>No todos in this session.</p></div>}
  </div>
}
