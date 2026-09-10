# Remotty visual system

The current direction is a branded consumer session inbox and conversation app.
Remotty's amber actions, bold Barlow titles, readable session rows, and conversation
bylines establish the product identity. Workspace groups lead into a dedicated
conversation with an anchored composer and bottom tabs; desktop expands this into
master-detail. The centralized themes use charcoal ink and clean light surfaces.
Barlow and IBM Plex Mono (code and paths) are self-hosted with OFL licenses.

The first three pass sections below are historical. The fourth pass describes the
current consumer-app refinement and supersedes the platform-native direction.
The final public refresh section describes the current landing, privacy, pairing,
and install surfaces; their earlier screenshots are historical.

## Design ownership

`public/design-tokens.css` is the shared color and typography source for the PWA
and static install guide. It defines both themes, semantic interaction and status
colors, code/diff colors, agent defaults, spacing, radii, elevation, and motion.
`src/styles.css` maps semantic colors to Tailwind and styles the working interface.
Public pages share `public/public-pages.css`. There is no copied install palette.

The blocking `public/theme-init.js` applies `remotty-theme` before application
rendering, defaults to dark, catches unavailable storage, and updates native
color-scheme and browser theme-color. `src/hooks/useTheme.ts` and `ThemeControl`
subscribe to the same API used by the static guide.

Shared UI lives in `src/components/ui`: Button/IconButton, Dialog, Field,
EmptyState, StatusIndicator, Tabs, and ThemeControl. Workspace dialogs and rows
live in `src/features/workspace`. Session content is split into activity messages,
tool details, changes, todos, agent selection, and composer components. Custom
hooks each live in their owning `hooks` directory. The relay hook moved to
`src/features/relay/hooks/useRelay.ts`; pure helpers live in `relayModel.ts`.

## Feature preservation audit

The initial source/test audit and final diff review covered these contracts:

- Manual routes, stored-identity redirect, session deep links, and immediate
  removal of fragment-only pairing credentials.
- Invite parsing, pasted pairing, native BarcodeDetector/ZXing fallback, camera
  errors and cleanup, and enrollment transition.
- Multiple workspaces, directory grouping/collapse, recent session filtering,
  older selected deep links, statuses, refresh, and capability-gated creation.
- Desktop split view, mobile list/detail navigation, retained session state,
  drafts, selected agents/tabs, cached reading, and Activity scroll intent.
- Markdown/GFM, timestamps, expandable tool inputs/output/errors/diffs,
  truncation, todos, lazy patches, not-Git/binary states, and subagents.
- Prompt shortcuts, autoresizing, stop-agent action, optimistic delivery,
  accepted/uncertain/failed outcomes, and cache failure reporting.
- Permission reject/once/always, question single/multiple/custom answers,
  validation, collapse, dismissal, and stale-request handling.
- Connection health, retries, freshness, offline recovery, notification settings,
  encrypted notification plumbing, deep links/actions, and device revocation.
- PWA update readiness, defer, error, retry, reload, and focus restoration.

Transport encryption, identity/cache formats, and protocol/backend behavior are
preserved. Intentional interaction improvements include keyboard agent selection,
roving keyboard tabs, shared modal focus containment, accessible field errors,
question selected-state semantics, clearing answers for replacement questions,
and preventing duplicate pending question submissions. Simultaneous request
panels scroll in a bounded region while the composer remains reachable.

## First-pass verification

Using Node 24.15.0 and pnpm 11.6.0:

- `pnpm --filter @remotty/web typecheck`: passed.
- `pnpm --filter @remotty/web test`: 36 files, 216 tests passed.
- `pnpm --filter @remotty/web build`: passed; a chunk-size advisory remains.
- `git diff --check`: passed.

Browser fixtures rendered the real workspace/session components with mocked
relay and update boundaries. Chromium covered dark/light at 320, 360, and 1440px:
public pages, static guide, empty/offline/error states, long paths/code/patches,
composer drafts, permissions/questions together, subagents, and update dialogs.
Measured layout, scrolling, focus, and contrast failures were fixed and rechecked.
Firefox additionally verified public pages in both themes, desktop Changes, and
the combined request/composer layout. Its minimum actual viewport was 500px in
this environment; narrow-phone evidence comes from Chromium.

Real device pairing, QR camera hardware, push delivery, update activation,
installed PWA behavior, production routing, and physical mobile keyboards/touch
were not exercised. These remain covered only to the extent of existing and
focused automated tests. Temporary browser fixtures were removed and the
loopback inspection server stopped. No deploy, publish, release/version change,
backend/protocol edit, or real device operation was performed.

## Second pass: the session journal

The working application now uses a conversation-centered composition. This pass
restructures JSX and layout while retaining the first pass's public pages, shared
semantic tokens, themes, and component extraction.

- `WorkspacePage` has a 280px desktop navigator with a compact workspace heading,
  recent-session count, attention count, and persistent new/refresh controls.
  The session list scrolls independently. Each row includes a written status,
  update age, branch, and diff totals. The large machine summary and status legend
  are removed. Selected rows expose `aria-current`, including legacy deep links.
- `SessionDetail` uses named grid regions for heading, content, tools, and dock.
  At 1100px and wider, a 176px right rail carries Activity, Todos, Changes, and
  capability-gated Subagents. Below that breakpoint the same shared Tabs component
  becomes a horizontally scrollable strip. At 720px and below the navigator and
  detail each occupy the full available width through the existing Back flow.
- The heading establishes a session title, written status, directory, and branch.
  `ActivityMessage` renders continuous full-width entries with author/time bylines
  and light separators. Avatar sigils, offset user bubbles, card borders, and card
  shadows are removed. Tool disclosures remain expandable within the stream.
- Agent selection, work progress, and Stop form a contextual command bar below
  the composer. Subagent mode retains Stop and offers Return to journal while
  keeping the root composer hidden. Requests scroll in a bounded region above
  the composer and commands. The permission reject column accommodates the shared
  44px coarse-pointer button size.
- The agent list is portalled outside the dock's clipping boundary. The shared
  `useAnchoredMenu` hook positions it above its trigger, bounds it to the viewport,
  and updates it for resize, scrolling, and visual-viewport changes.
- Subagent messages reuse the journal renderer, including Markdown/GFM, bylines,
  timestamps when supplied, and tool inputs/output/errors/diffs. Their independent
  message scroller and existing follow behavior remain in place.

The existing transport, request routing, optimistic delivery, message cache,
retained drafts, agent selection, tab state, and Activity scroll hook continue to
own those behaviors. The new `useMediaQuery` hook supplies the matching ARIA tab
orientation; shared roving focus and Arrow/Home/End navigation are retained.
An unloaded Changes count displays a dash until the lazy diff request runs.

### Second-pass verification

Using Node 24.15.0 and pnpm 11.6.0:

- `pnpm --filter @remotty/web typecheck`: passed.
- `pnpm --filter @remotty/web test`: 37 files, 219 tests passed.
- `pnpm --filter @remotty/web build`: passed. Vite's existing advisory for chunks
  larger than 500kB remains.
- `git diff --check`: passed.

New behavioral coverage verifies selecting the prompt agent in the dock, sending
with that selection, reaching Stop in Subagents, returning with the draft intact,
and rendering cached child Markdown/tool content. Agent-picker tests now query
the portalled listbox. Layout contracts describe the grid regions, responsive rail,
and bounded request stack instead of the previous header and sticky-form layout.
Existing behavioral tests, including all seven Activity scroll tests and all seven
workspace connection-stability tests, pass.

Chromium rendered the actual WorkspacePage and session components against an
isolated mock relay on loopback port 5187. Dark and light themes were inspected at
1440*900, 900*900, 360*640, and 320*640; an earlier pass also covered 900px-tall
phone viewports. The fixture exercised journal activity, expanded patches, todos,
subagents, agent menus, mobile list/detail switching, and simultaneous permission
and question requests. Automated browser assertions verified:

- no document width overflow at each viewport;
- agent menus stay within the viewport;
- drafts survive tab round-trips;
- keyboard Home/End moves focus and selection through the rail/tabs;
- a 100px Activity reading position returns after a Todos round-trip;
- question confirmation can scroll into view above the composer;
- commands remain within the viewport with requests present;
- no browser page errors during the final matrix.

Evidence is saved outside the repository at `/tmp/opencode/journal-results.json`
and `/tmp/opencode/journal-*.png`. Representative screenshots are
`journal-1440-dark.png`, `journal-320-light.png`,
`journal-menu-320-dark.png`, and `journal-subagents-360-light.png`.
The fixture runner is `/tmp/opencode/journal-inspect.mjs`; its temporary server
and browser close on completion. The existing app server, PID 1744373 on
`127.0.0.1:5173`, remains running and returned HTTP 200 after verification.

This second pass used Chromium; Firefox MCP was not available in this session.
Browser evidence uses fixture data, not a live paired device. Physical mobile
keyboards, real pairing/camera, push delivery, and installed-PWA behavior were not
exercised. The earlier public-page evidence belongs to the first pass above.

## Third pass: native inbox and conversation

- `WorkspacePage` now leads with a large Remotty title, workspace description,
  attention summary when needed, and clear Sessions/new/refresh controls. Grouped
  full-width rows use 17px Barlow titles, 15px written statuses, update ages, and
  secondary branch/change previews. Workspace groups retain collapse behavior.
  Connection, theme, source, and notification actions live in the inbox footer.
  At 720px and below, selecting a row opens the full conversation; Back restores
  the inbox. Desktop uses a 360px inbox beside the same conversation component.
- `SessionDetail` has one compact navigation bar with Back, session title, status,
  and workspace. A native details disclosure exposes the full title, directory,
  and branch, including long paths. `useDismissibleDetails` supports outside
  dismissal and Escape with trigger focus restoration.
- Activity uses readable 16px messages, quiet assistant entries, and distinct
  user bubbles. Markdown headings and list markers are explicit; code, tables,
  expanded tool output, and lazy patches remain independently contained.
- Activity, Todos, Changes, and capability-gated Subagents use the shared semantic
  Tabs primitive at the bottom on **all** screen sizes. The tabs fit without
  horizontal scrolling at 320px, expose counts from actual state, and retain
  roving focus, Arrow/Home/End navigation, and panel associations. Changes retains
  its unloaded count indicator. DOM reading order follows content, composer,
  accessories, then tabs; the desktop tool rail is gone.
- The composer sits above bottom navigation with a compact agent/progress/Stop
  accessory bar. Agent options remain real and portalled; prompts use the chosen
  agent. Subagents retains Stop and Back to Activity, preserving the root draft.
  Permission and question panels share a bounded scroll region above the pinned
  composer. `useVisualViewport` follows keyboard resize/viewport offsets while
  ignoring pinch zoom and cleans up its subscriptions. The shell falls back to
  dynamic viewport units where the API is unavailable.
- Shared tokens now define 16px body sizing and 10-14px-scale control surfaces.
  Public, pairing, privacy, and the static install guide share Barlow hierarchy,
  readable fields, sentence-case controls, and rounded surfaces. Their content
  and actions remain intact. Mobile dialogs and scanner errors use bottom sheets
  with existing focus containment, dismissal, accessible fields, and camera/ZXing
  fallback. Existing themes and persistence remain in place.
- Only a restrained conversation entrance runs when reduced motion is not
  requested. Repeating decorative attention/work animations were removed.

The complete feature-preservation checklist above still applies. This pass keeps
the existing relay, cache, identity, routes, optimistic delivery, permission and
question handling, lazy resources, and Activity scroll hook. No protocol/backend
or release behavior changed.

### Third-pass verification

Using Node **24.15.0** and pnpm **11.6.0**:

- `pnpm --filter @remotty/web typecheck`: passed.
- `pnpm --filter @remotty/web test`: **38 files, 222 tests passed**.
- `pnpm --filter @remotty/web build`: passed; the existing >500kB chunk advisory
  remains.
- `git diff --check`: passed.

Updated layout contracts cover the native master-detail shell, bottom navigation,
and viewport-bounded request stack. Behavioral tests cover keyboard viewport
resize/offsets/pinch zoom/cleanup, navigation reading order, full context and
Escape focus restoration, actual agent submission, and draft restoration.
All seven Activity scroll tests and all seven connection-stability tests pass.

Chromium rendered **real components with mocked relay boundaries** at 320*640,
390*844, and 1440*900 in both themes. The final screenshots were opened and
visually inspected. Initial inspection found inherited monospace/muted inbox
titles and missing Markdown list markers; both were fixed and recaptured.
The browser harness verifies:

- no document width overflow, bottom tabs below the composer and inside viewport;
- group collapse, new-session sheet focus containment and Escape;
- full session context, Escape dismissal, bounded agent menus;
- selected-agent prompt submission through the mocked request boundary;
- Todos counts, expanded long-path Changes, Subagents and reachable Stop;
- draft retention, keyboard tab selection, Activity reading-position restoration;
- simultaneous permission/question scrolling with confirmation above composer;
- a resized 380px-high keyboard simulation with positive request-scroll height
  and composer/tabs remaining on screen;
- landing, privacy, pairing, static install, scanner-error/paste fallback,
  offline/error, and empty states, plus reduced-motion behavior;
- zero browser page errors across the final matrix.

Evidence: `/tmp/opencode/native-results.json`, `/tmp/opencode/native-inspect.mjs`,
and `/tmp/opencode/native-*.png`. Representative images include
`native-inbox-390-dark.png`, `native-inbox-320-light.png`,
`native-activity-320-dark.png`, `native-activity-390-light.png`,
`native-activity-1440-light.png`, `native-question-320-light.png`,
`native-keyboard-320-light.png`, and `native-sheet-320-light.png`.
The harness closes its browser and temporary loopback server on completion.
The static guide is loaded explicitly from `/install/index.html` in the Vite
fixture and its heading is asserted before capture; production directory-index
routing is not established by this fixture.
The original app server **PID 1744373 at 127.0.0.1:5173** remains running and
returned HTTP 200 after verification.

Runtime limits: this pass used Chromium fixtures, not live paired devices or
Firefox/WebKit. A smaller browser viewport exercises the layout and viewport
hook; it does not reproduce every physical iOS/Android keyboard behavior. Real
pairing, camera hardware, push delivery, update activation, and installed-PWA
behavior were not exercised. No real invites/devices/push were activated.

## Fourth pass: Remotty consumer identity

- The inbox leads with a compact Remotty brand, bold "Your sessions" heading,
  actual recent-session count, workspace name, and a labeled amber "New session"
  action. Refresh remains adjacent. Full-width rows show readable 18px titles,
  update age, written status, and a conversation/attention symbol. Workspace
  grouping and collapse remain; full directory context is available in the session.
- Appearance, source, and disconnect live in one Settings disclosure with shared
  outside-dismissal and Escape/focus behavior. Connection and labeled notification
  controls remain available in the footer; notification state uses aria-pressed.
- Session titles can occupy two lines. The chevron disclosure includes full title,
  directory, branch, and addition/deletion totals. Conversation bylines have a
  Remotty sigil, distinct amber user messages, readable timestamps, and 16px body.
  Agent selection is explicitly labeled "Agent"; send uses the same amber as new
  session. Activity, Todos, Changes, and Subagents retain their roles and counts.
- Permission/question surfaces use a shared amber edge and quiet background.
  Question options are full-width choices with both a check and emphasized selected
  state; Continue uses the primary brand action. Request scrolling remains bounded
  above the composer, including simultaneous requests and small keyboard viewports.
- `design-tokens.css` owns the updated charcoal/white themes and brand action
  colors, separately from accessible accent text colors. Public pages also consume
  the shared surface palette. Transport/cache/protocol code was not changed by this
  refinement. Existing working-tree work and `.serena/` were preserved.

### Fourth-pass verification

Node **24.15.0**, pnpm **11.6.0**:

- `pnpm --filter @remotty/web typecheck`: passed.
- `pnpm --filter @remotty/web test`: **38 files, 223 tests passed**.
- `pnpm --filter @remotty/web build`: passed, with the existing >500kB chunk advisory.
- `git diff --check`: passed. No generated artifacts appear in Git status.

Focused coverage adds settings outside/Escape dismissal, focus restoration, and
mocked notification/disconnect action wiring. Layout contracts now describe the
consumer inbox, labeled primary action, utility disclosure, and retained totals.

The real-component Chromium matrix passed at **320x640, 390x844, and 1440x900** in
both themes, with **zero page errors**. It rechecks group collapse, modal focus,
session context, agent menus and actual selected-agent prompt payloads, lazy Changes,
Todos/Subagents counts, Stop, retained drafts, keyboard tab selection, Activity scroll
restoration, simultaneous requests, selected question semantics, and reduced motion.
The 380px-high keyboard simulation retains a positive request region and visible
composer/navigation. Public, pairing fallback, install, offline, and empty routes
also pass the width checks. Screenshots were opened and visually inspected; the
agent label was refined and the full matrix recaptured afterward.

Evidence is in `/tmp/opencode/consumer-results.json` and `consumer-*.png`, driven by
`/tmp/opencode/consumer-inspect.mjs` using the prior real-component fixture matrix.
Representative images: `consumer-inbox-390-dark.png`, `consumer-inbox-320-light.png`,
`consumer-activity-390-light.png`, `consumer-activity-320-dark.png`,
`consumer-activity-1440-dark.png`, `consumer-decision-selected-390-light.png`, and
`consumer-keyboard-320-light.png`. The temporary server/browser closed on completion.
The original app server at **127.0.0.1:5173** returned HTTP **200** afterward.

Browser evidence uses mocked relay boundaries. Real pairing, camera hardware, push,
installed-PWA behavior, physical phone keyboards, Firefox, and WebKit were not
exercised in this pass.

## Public refresh: your agents, within reach

The public pages now extend the consumer app's Barlow typography, amber pill
actions, floating rounded navigation, message-shaped warm callouts, and quiet
charcoal/mineral surfaces. Privacy information uses the shared teal tokens.
`PublicHeader`, `PublicFooter`, `PublicBrand`, and the new `PublicAction` own React
public chrome. `public/public-pages.css` owns its styling and the static install
guide; `src/public.css` imports it and owns routed public layouts. The existing
central tokens, first-paint theme script, theme persistence, and working app CSS
are unchanged. No dependencies or release versions changed.

The landing leads with "Your agents. Within reach.", install/pair actions, and a
real session image. Desktop displays it at 340px wide; mobile places the actions
first and limits the image to 280px. The old fabricated `PhonePreview` is removed.
The user-authorized `Screenshot_20260910-142159.png` was cropped from 1080*2400 to
1080*2214 at (0, 120), removing only OS status/gesture regions. Conversation pixels
were not replaced. Metadata-stripped WebP assets are 360*738 (34,306 bytes) and
720*1476 (79,196 bytes), with responsive sources, explicit dimensions and descriptive
alt text. The original stays outside the repository.

Pairing retains its Field validation, paste flow, autofocus, scanner dialog focus,
BarcodeDetector/ZXing fallback, camera errors and cleanup. The compact scanner
sheet inherits the public surfaces. Privacy retains every data-handling disclosure
and security boundary. The static guide keeps every command, endpoint option,
restart instruction, warning, reference link and heading anchor. Theme JavaScript,
crawler artifacts, application routing and production routing are unchanged.

Validation used Node 24.15.0 and pnpm 11.6.0:

- Web typecheck and build passed; the existing >500kB bundle advisory remains.
- Full web suite: 49 files, 344 tests passed. New rendered-content tests cover the
  image and optimized files, navigation, privacy disclosures, complete command
  reference, and invalid pasted-invite field association. Focused public tests
  passed again after the final static style adjustments. `git diff --check` passed.
- Actual production-build routes `/`, `/privacy`, `/pair`, `/install/` were loaded
  at 320, 390 and 1440px in both themes in Chromium and Firefox: 24 cases each.
  Screenshots were opened for visual review. Chromium additionally checked CTA
  contrast (at least 4.5:1), feature-anchor navigation, command keyboard scrolling,
  footer reachability, theme controls, and camera-error/Escape/paste fallback;
  it reported no page errors. Both browsers passed horizontal-overflow checks.
- Evidence and rerunnable scripts are under `/tmp/opencode/public-consumer-*`:
  `public-consumer-results.json`, `public-consumer-firefox-results.json`, and PNGs
  for each route/theme/width, plus feature and scanner views.
- The existing loopback server on 5173 remains available and real public routes
  were checked there. Vite's `/install/` falls through to the SPA pairing screen;
  use `/install/index.html` in development. The production preview served the
  actual static guide at `/install/`. Temporary production-preview and Firefox
  processes were stopped after verification.

No real pairing, invites, device changes, camera hardware, push delivery, PWA
installation, or physical phone keyboard was exercised. No commit or deployment
was made. `.serena/` and unrelated workspace content were preserved.
