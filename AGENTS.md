# AGENTS.md

## Web UI

`packages/web` (`@fabrium/web`, private, never published) is the Fabrium web UI. It replaced the Zooid web client and is built from three sources: the Zooid web client's data layer, Buzz's Slack-like components, and Haven's design system. The CLI serves `packages/web/dist` (`packages/cli/src/web/*`). Open work, open decisions and the backlog are in [`FABRIUM_WEB_UI_PLAN.md`](./FABRIUM_WEB_UI_PLAN.md). The rules below are binding for every change to `packages/web` or `packages/cli/src/web/*`.

### Naming

- The web UI takes Haven's design system without its name: never write `aqua` or `jan3` (any case) anywhere in `packages/web`. Product name in the UI: `Fabrium`. `pnpm -C packages/web lint` (`scripts/check-design.sh`) enforces this.

### Architecture

- Matrix is the client protocol. Fabrium data that belongs to a room is a `dev.fabrium.*` event in that room; data not tied to a room comes from the Fabrium service API. Extension rules are in the plan, section 5.
- Keep the data layer UI-agnostic: `src/client/*`, `src/events/*`, `src/lib/matrix/*`, `src/hooks/*`. Pure mappers in `src/model/from-matrix.ts` turn Matrix objects into the view model (`src/model/types.ts`).
- Presentational components take plain props typed from `src/model/types.ts`. Only containers and hooks touch `matrix-js-sdk`.
- Build only what the backend emits today. Anything else goes to the plan's backlog.
- Fixed stack: `react-router-dom` (no TanStack Router or Query); shadcn + Radix primitives in `src/components/ui/*`, not Haven's native dialog/popover primitives; markdown via `marked` + `dompurify` + `html-react-parser` (no `react-markdown`, no `shiki`); diffs via `diff-view.tsx` + `lib/line-diff.ts`.
- No new dependency without a note in the PR. Run `package-vetting` before each `pnpm add`; respect `minimumReleaseAge` in `pnpm-workspace.yaml`.
- Every file in `src/` must be reachable from `src/main.tsx` (`scripts/check-orphans.mjs`, part of `lint`). Delete what nothing uses.
- File names are kebab-case.

### Design

- Tokens live in `src/styles/`: `tokens.css` (primitives `--fab-*` + semantic tokens per theme) and `fabrium-tokens.css` (actor and trust markers, light-theme contrast overrides). shadcn variable names are aliases of the semantic tokens in `index.css`; an alias must never equal its `@theme` key.
- Components use semantic token classes only. `lint` rejects raw hex, Tailwind palette colors (`bg-red-500`), `var(--fab-*)` outside `src/styles/`, and direct `lucide-react` imports. The only place with literal hex is `components/brand/colors.ts`.
- No new color without design sign-off; map to existing primitives (`color-mix` is fine). Text must clear WCAG AA in both themes; `e2e/axe.spec.ts` checks it.
- Fabrium tokens (`--actor-agent`, `--actor-human`, `--actor-system`, `--trust-enclave`, `--control-plane`, `--risk`, `--money`) mark identity and trust only, never general chrome.
- Type scale `text-h1…h5`, `text-subtitle`, `text-body1/2`, `text-caption1/2`; headings `font-heading` (Manrope), body `font-sans` (Inter), weights 400/500/600. Radius `rounded-utility` 8 (controls), `rounded-card` 12, `rounded-modal` 16, `rounded-pill` (chips; `rounded-full` only on avatars and dots). Shadows `shadow-button`, `shadow-surface`, `shadow-modal`.
- Theme is `data-theme="light|dark"` on `<html>` (default dark, preference `system|light|dark`, key `fabrium:theme:v1`); `dark:` variants follow it.
- Icons are `lucide-react` glyphs re-exported as `NameIcon` from `src/components/icons/index.ts`, and imported only from there. No drawn SVGs.
- Every new presentational component gets a Storybook story. Stories render in both themes via the toolbar.

### Copying from Buzz

- Copy presentational components and pure logic only, never `shared/api/**`, react-query hooks, Nostr code, `@tauri-apps/*` imports, or `features/*/lib/*Sync.ts`. Containers are rebuilt on this repo's hooks; all data comes in through props.
- First commit = the verbatim copy with the header, second commit = the adaptation, so reviewers diff the second.
- Header on every file derived from Buzz: `// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/<path>. Modified.` and an entry in `packages/web/THIRD_PARTY_NOTICES.md`. Never copy `desktop/public/pow/**` (MIT, Emerge Tools).
- Files from Haven get no header unless the file's history in the Haven repo (`git log --follow <file>`) shows they came from Hugging Face chat-ui. Then add `// Derived from Hugging Face chat-ui (Apache-2.0). Modified.` and list them in `THIRD_PARTY_NOTICES.md` under "Hugging Face chat-ui, Copyright 2018- The Hugging Face team, Apache-2.0".
- On copy, rewrite Buzz classes onto the design system: `text-message` → `text-body2`; `text-xs/sm/base/lg` → `text-caption1/body2/body1/subtitle`; `rounded-md/lg/squircle` → `rounded-utility` or `rounded-card`; palette colors → `accent-*` tokens; `--conversation-*` and `--buzz-*` vars deleted; `data-buzz-*` deleted or renamed `data-fab-*`.

### Fabrium UI rules

- Actors are `human`, `agent` or `system`. An agent is a user in the workforce space's `dev.zooid.workforce` roster; nothing else marks a user as an agent. Agent label: `Persona · Project` (persona falls back to the agent's name, project to the workforce space name). Agent messages carry an `agent` badge, system users a `system` badge, humans none. Lists group agents by persona.
- Only humans can resolve approvals: hide approval buttons for agents. A resolved approval shows responder, decision and time; a timeout reads as denied.
- Media only through authenticated media blob URLs. Never render agent HTML unsanitized, never embed previews in the client origin, never display secret values.
- UI copy says workspace, project, channel, room, thread, agent, persona, approval; never space, bot, server or guild. Roles: owner, admin, manager, member, guest. Plain technical English, short sentences, active voice.
