import { Check, CircleHelp, GitPullRequestArrow, ShieldCheck, Terminal } from "lucide-react"

export function PhonePreview() {
  return (
    <figure className="activity-specimen" aria-label="Example of a live remotty activity stream">
      <figcaption><span>Live activity / pairing-redesign</span><strong><i /> connected</strong></figcaption>
      <div className="activity-specimen__context">
        <span>OpenCode workspace</span>
        <strong>Ship public pages</strong>
        <code>~/projects/remotty</code>
      </div>
      <ol className="activity-specimen__log">
        <li><time>09:41:08</time><span className="activity-specimen__icon"><Terminal /></span><div><strong>Read application routes</strong><code>src/app/App.tsx</code></div><b className="is-success"><Check /> done</b></li>
        <li><time>09:41:16</time><span className="activity-specimen__icon"><GitPullRequestArrow /></span><div><strong>Update public shell</strong><code>4 files changed</code></div><b className="is-info">running</b></li>
        <li className="needs-action"><time>09:42:02</time><span className="activity-specimen__icon"><ShieldCheck /></span><div><strong>Permission requested</strong><code>pnpm --filter @remotty/web build</code></div><b className="is-warning">review</b></li>
        <li><time>09:42:19</time><span className="activity-specimen__icon"><CircleHelp /></span><div><strong>Agent has a question</strong><p>Keep the install guide available without JavaScript?</p></div><b className="is-warning">waiting</b></li>
      </ol>
      <div className="activity-specimen__response"><span>Reply from your phone</span><strong>Yes, preserve the static guide.</strong></div>
    </figure>
  )
}
