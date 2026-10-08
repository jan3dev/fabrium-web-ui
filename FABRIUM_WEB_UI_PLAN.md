# Fabrium Web UI Plan: Buzz UI + Haven design system on Zooid

Status: plan, not started. Audience: coding agents. Created 2026-10-06.

## 0. Sources

| Key   | Path                                                                                                                                                      | Role                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ZW`  | `github.com/zooid-ai/clients` → `packages/web` (`@zooid/web` 0.14.0, MIT)                                                                                 | Current UI. Base: data layer, hooks, Zooid event decoders, tests  |
| `BZ`  | `/Users/tw/dev/jan3/buzz/desktop/src` (Apache-2.0, Block, Inc.)                                                                                           | Slack-like UI components and patterns to copy                     |
| `HV`  | `/Users/tw/dev/jan3/haven-chat-ui/src` (Apache-2.0; parts derived from Hugging Face chat-ui, see its `NOTICE`) | Design system: tokens (palette, type, radius, shadows, motion), primitives' visual spec, chat visuals. Source of truth for all colors |
| `FB`  | `/Users/tw/dev/jan3/fabrium/docs/architecture.html`, `design.html`, `git -C /Users/tw/dev/jan3/fabrium show 3cc3da8:docs/design.md`, `catalog/fabrium/**` | Fabrium spec. `§N` = design.md section                            |
| `CLI` | `packages/cli/src/web/*`, `packages/cli/src/commands/dev.ts` (this repo)                                                                                  | Fetches and serves the web bundle                                 |

Naming rule: the design system is taken from Haven without its name. Never write `aqua` or `jan3` (any case) anywhere in `packages/web`: code, CSS, class names, token names, comments, assets, UI copy, `package.json`. Name tokens by role. Product name in UI: `Fabrium`.

## 1. Fixed decisions

| #   | Decision                                                                                                                                                                                                                                                                 | Reason                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| D1  | New package `packages/web` in this repo. Seed it by copying `ZW/packages/web` as-is. The build must stay green before any UI change                                                                                                                                      | Keeps working Matrix data layer, Zooid event decoders, 100+ tests, Storybook, Playwright                                                    |
| D2  | Keep `ZW` data layer unchanged: `src/client/*`, `src/events/*`, `src/lib/matrix/*`, `src/lib/*`, `src/hooks/*`                                                                                                                                                           | UI-agnostic, tested, `useSyncExternalStore` over matrix-js-sdk                                                                              |
| D3  | Do NOT copy from `BZ`: `shared/api/**`, react-query hooks, Nostr code, any `@tauri-apps/*` import, `features/*/lib/*Sync.ts`                                                                                                                                             | Coupled to Nostr relay over Tauri                                                                                                           |
| D4  | Copy from `BZ` only presentational components and pure logic (classes P and A in §4). All data comes in through props. Containers are rewritten on `ZW` hooks                                                                                                            | Buzz containers are bound to Nostr                                                                                                          |
| D5  | Add a view-model layer: `src/model/types.ts` (Fabrium-shaped types) + `src/model/from-matrix.ts` (mappers MatrixEvent/Room/RoomMember → view model). Components import `src/model/types.ts`, never `matrix-js-sdk` | Copied Buzz components take plain props; one place where Matrix meets the UI; pure mappers are easy to test |
| D6  | Keep `react-router-dom` (`ZW`). Do not add `@tanstack/react-router` or `@tanstack/react-query`. Replace Buzz `useAppNavigation`/`useChannelNavigation` calls with react-router `useNavigate`/`useSearchParams`                                                           | Fewer deps; `ZW` routes and tests already work                                                                                              |
| D7  | Keep shadcn + Radix primitives (`ZW/components/ui`, `BZ/shared/ui`). Re-skin them with the Haven design tokens. Do NOT port Haven's native `<dialog>`/`popover` primitives                                                                                                                  | Copied Buzz components import shadcn primitives; one primitive set only                                                                     |
| D8  | Design tokens come from `HV/styles/tokens.css`. On copy: rename primitive prefix `--aqua-` → `--fab-`, keyframes and utilities `aqua-*` → `fab-*`, delete comments naming the upstream. Shadcn variable names become aliases of the semantic tokens (§3.2) | Buzz/shadcn classes (`bg-background`, `text-muted-foreground`) then render in the Haven look without edits |
| D9  | Theme: `data-theme="light                                                                                                                                                                                                                                                | dark"`on`<html>`, default `dark`, preference `system                                                                                        | light | dark`. Keep `dark:`utilities working via`@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] \*))` | Haven convention; copied code uses `dark:` |
| D10 | Upgrade to React 19 and current Vite + `@vitejs/plugin-react` (respect `minimumReleaseAge` in `pnpm-workspace.yaml`)                                                                                                                                                     | `BZ` and `HV` are React 19                                                                                                                  |
| D11 | All icons are `lucide-react` glyphs, imported from `src/components/icons/index.ts` only, which re-exports them as `NameIcon`. No drawn SVGs, no `vite-plugin-svgr`. Lint bans direct `lucide-react` imports elsewhere (settled O4) | One icon family, one import site; a glyph swap is a one-line change |
| D12 | Markdown: keep `ZW` pipeline (`marked` + `dompurify` + `html-react-parser`, `formatted-message-body.tsx`). Port `HV` `.markdown` CSS and `highlight.js` → `--syntax-*` mapping, and `HV` `CodeBlock`. Do not copy `BZ/shared/ui/markdown.tsx`, `shiki`, `react-markdown` | `BZ` markdown is coupled; Haven code blocks already use the tokens                                                                         |
| D13 | Diffs: keep `ZW` `diff-view.tsx` + `lib/line-diff.ts`. Do not add `react-diff-view`                                                                                                                                                                                      | No new dep                                                                                                                                  |
| D14 | File names kebab-case (`ZW` convention). Rename Buzz `PascalCase.tsx` on copy                                                                                                                                                                                            | Match host repo                                                                                                                             |
| D15 | Build only what Zooid's backend emits today. Fabrium surfaces without backend events go to §9 Backlog                                                                                                                                                                    | YAGNI                                                                                                                                       |
| D16 | Package `@fabrium/web`, `"private": true`, never published to npm. `CLI` serves `packages/web/dist` from this repo. Delete the npm fetch path (§2) | No npm publishing needed |
| D17 | Matrix stays the client protocol for Fabrium. Fabrium data that belongs to a room = custom `dev.fabrium.*` events in that room. Data not tied to a room = Fabrium service HTTP API. Rules in §6.5 | Matrix covers messaging, hierarchy, roles, media, E2EE, calls natively; the Zooid daemon is already an appservice |

## 2. Contract the new bundle must keep (from `CLI`)

- `packages/web/package.json`: name `@fabrium/web`, `"private": true`, no `files`/`publishConfig`. `dist/index.html` at dist root; Vite default `base: "/"`; assets under `/assets/`.
- Reads same-origin `/config.json` at runtime: `homeserver_url`, `workforce_space`, `push_gateway_url`, `vapid_public_key`, `default_idp_label`, `global_search` (snake_case). No build-time-only config.
- History routes: `/`, `/room/:roomId?thread=<rootId>&event=<eventId>`, `/login`, `/signup`, `/auth/callback`, `/search`, `/invites`. New routes allowed; keep these.
- `public/sw.js` → `dist/sw.js`; pusher `app_id` = `dev.zooid.web`.
- `vite build --watch` works in `packages/web` (used by `zooid dev --watch-web`).
- `CLI` changes:
  - `packages/cli/src/web/resolve.ts`: resolve order `ZOOID_DEV_WEB_ROOT_OVERRIDE` → `<repoRoot>/packages/web/dist`. Missing dist → error "run `pnpm -C packages/web build`". Delete sibling `zooid-clients` detection. Update `resolve.test.ts`.
  - `packages/cli/src/bin.ts` / `commands/dev.ts`: `--watch-web` default path → `packages/web`.
  - Delete `packages/cli/src/web/fetch.ts`, `pin.ts`, their tests, `fetch.integration.test.ts`, `test-helpers.ts` if unused, `"zooid": { "webVersion" }` in `packages/cli/package.json`, and the `tar` dependency if nothing else uses it.
  - Root `pnpm build` builds `packages/web` before `packages/cli` (workspace dependency or `pnpm -r` order).

## 3. Design foundation

### 3.1 Files

| Target (`packages/web/src/…`)         | Source                                                        | Action                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles/tokens.css`                   | `HV/styles/tokens.css`                                        | Copy, then apply D8 renames. Delete header comments naming the upstream                                                                                                                                                                                                                                                                               |
| `styles/fabrium-tokens.css`           | new                                                           | Fabrium semantic tokens (§3.3). Reference `--fab-*` primitives only                                                                                                                                                                                                                                                                     |
| `index.css`                           | `ZW/src/index.css` + `HV/app/globals.css`                     | Replace `ZW` palette. Import `tokens.css`, `fabrium-tokens.css`. Port from `HV/globals.css`: `@theme inline` bridge, base styles, `.markdown`, hljs→`--syntax-*`, `@utility scrollbar-custom`, `modal-motion`, `drawer-motion`, keyframes `aqua-*` renamed `fab-*`, `prefers-reduced-motion` block, `:focus-visible` rule. Add shadcn alias block (§3.2) |
| `components/brand/colors.ts` (+ test) | `HV/components/brand/colors.ts`, `colors.test.ts`             | Copy. Only place with literal hex (manifest, theme-color)                                                                                                                                                                                                                                                                                |
| `components/icons/index.ts`           | new                                                           | `lucide-react` re-exports under the `NameIcon` scheme (D11) |
| `components/theme-provider.tsx`       | `ZW` same file                                                | Change: set `document.documentElement.dataset.theme`, `style.colorScheme`, `<meta name="theme-color">` from `brand/colors.ts`; default `dark`; storage key `fabrium:theme:v1`                                                                                                                                                            |
| `index.html`                          | `ZW/index.html`                                               | `<html data-theme="dark">`; inline theme bootstrap script in `<head>` (port `THEME_BOOTSTRAP` from `HV/app/layout.tsx`); title `Fabrium`                                                                                                                                                                                                 |
| fonts                                 | `HV/app/layout.tsx` (`next/font`)                             | Replace with `@fontsource-variable/manrope` + `@fontsource-variable/inter`; define `--font-manrope`, `--font-inter` in `index.css`. Remove `@fontsource-variable/geist`                                                                                                                                                                  |

Remove from `ZW/src/index.css`: Geist, "Reef" palette, `--radius: 0.2rem`, `.dark` class variant, `chart-*` vars.

### 3.2 Shadcn → semantic token alias map (in `index.css`, `:root` scope, both themes inherit)

| shadcn var                                  | semantic token                |
| ------------------------------------------- | ---------------------------------- |
| `--background`                              | `--surface-background`             |
| `--foreground`                              | `--text-primary`                   |
| `--card`, `--popover`                       | `--surface-primary`                |
| `--card-foreground`, `--popover-foreground` | `--text-primary`                   |
| `--primary`                                 | `--button-primary-background`      |
| `--primary-foreground`                      | `--button-primary-foreground`      |
| `--secondary`                               | `--surface-secondary`              |
| `--secondary-foreground`                    | `--text-primary`                   |
| `--muted`                                   | `--surface-secondary`              |
| `--muted-foreground`                        | `--text-secondary`                 |
| `--accent`                                  | `--surface-selected`               |
| `--accent-foreground`                       | `--text-primary`                   |
| `--destructive`                             | `--accent-danger`                  |
| `--destructive-foreground`                  | `--text-inverse` _verify contrast_ |
| `--border`                                  | `--surface-border-primary`         |
| `--input`                                   | `--surface-border-secondary`       |
| `--ring`                                    | `--button-focus-ring`              |
| `--sidebar`                                 | `--surface-primary`                |
| `--sidebar-foreground`                      | `--text-primary`                   |
| `--sidebar-accent`                          | `--surface-secondary`              |
| `--sidebar-accent-foreground`               | `--text-primary`                   |
| `--sidebar-primary`                         | `--accent-brand`                   |
| `--sidebar-border`                          | `--surface-border-primary`         |
| `--sidebar-ring`                            | `--button-focus-ring`              |
| `--radius`                                  | `--fab-radius-utility` (8px)      |
| `--warning` (Buzz)                          | `--accent-warning`                 |

Rules:

- A shadcn alias name must never equal its `@theme` key (`--color-x: var(--x)` fine; `--x: var(--x)` is a silent cycle). See `HV` naming hazard note in `tokens.css`.
- Radius utilities: `rounded-utility` 8, `rounded-card` 12, `rounded-modal` 16, `rounded-pill` 80. Map shadcn `rounded-md/lg` usages in copied code to these.
- Typography utilities: `text-h1…h5`, `text-subtitle`, `text-body1`, `text-body2`, `text-caption1`, `text-caption2`. Headings `font-heading` (Manrope), body `font-sans` (Inter), weights 400/500/600 only.
- Shadows: `shadow-button`, `shadow-surface`, `shadow-modal`.

### 3.3 Fabrium semantic tokens (`styles/fabrium-tokens.css`)

Map `FB` architecture-page legend onto existing Haven primitives (`--fab-*` after rename). No new hex.

| Token             | Meaning (`FB`)         | Light                                           | Dark                      |
| ----------------- | ---------------------- | ----------------------------------------------- | ------------------------- |
| `--actor-agent`   | agent                  | `--fab-neon-blue-500`                          | `--fab-neon-blue-300`    |
| `--actor-human`   | human or approval      | `--fab-harvest-gold-500`                       | `--fab-harvest-gold-500` |
| `--actor-system`  | external / integration | `--fab-metal-500`                              | `--fab-metal-400`        |
| `--trust-enclave` | TEE / CVM              | `--fab-wave-cyan`                              | `--fab-wave-cyan`        |
| `--control-plane` | control plane          | `--fab-violet-600`                             | `--fab-violet-400`       |
| `--risk`          | denied or risk         | `--accent-danger`                               | `--accent-danger`         |
| `--money`         | sats                   | `--fab-wave-orange`                            | `--fab-wave-orange`      |
| `--*-transparent` | chip backgrounds       | `color-mix(in srgb, var(--x) 16%, transparent)` | same                      |

Bridge each into `@theme inline` as `--color-actor-agent` etc. Use these only for identity and trust markers, not for general UI chrome.

### 3.4 Primitive re-skin (`src/components/ui/*`, shadcn cva files)

| shadcn file                                                 | Copy visual spec from `HV/components/ui/`   | Notes                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button.tsx`                                                | `Button.tsx`                                | cva variants `primary`, `secondary`, `tertiary` (pill, `h-14`→ use `h-10` in dense chat chrome, `rounded-pill`), `utility` (`rounded-utility h-[34px]`/`h-[28px]`), `tone: danger`. Keep shadcn API names as aliases: `default`→`primary`, `outline`→`secondary`, `ghost`→`tertiary`, `destructive`→`utility+danger` |
| `icon-button.tsx` (new)                                     | `IconButton.tsx`                            | `size-7`/`size-8`, `rounded-utility`, required `label` → `aria-label` + Tooltip                                                                                                                                                                                                                                      |
| `badge.tsx`                                                 | `Chip.tsx`                                  | tones neutral/success/warning/danger/brand + Fabrium `agent`/`human`/`system`/`enclave`                                                                                                                                                                                                                              |
| `alert.tsx` (from `BZ/shared/ui/alert.tsx`)                 | `Callout.tsx`                               | tones info/success/warning/danger                                                                                                                                                                                                                                                                                    |
| `card.tsx`                                                  | `Card.tsx`                                  | `rounded-card border bg-surface-primary`, `raised` → `shadow-surface`                                                                                                                                                                                                                                                |
| `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`               | `Modal.tsx`                                 | `rounded-modal shadow-modal`, backdrop `bg-black/40 backdrop-blur-xs`, `modal-motion`, padding `p-6 gap-4`, title `text-h5 font-semibold font-heading`, bottom sheet below `md`                                                                                                                                      |
| `dropdown-menu.tsx`, `context-menu.tsx`, `popover.tsx`      | `Menu.tsx`                                  | surface `rounded-card border bg-surface-primary shadow-modal p-1 min-w-40`; item `rounded-utility text-body2 px-2.5 py-1.5 gap-2 hover:bg-surface-secondary [&_svg]:size-4`; danger `text-accent-danger`                                                                                                             |
| `tooltip.tsx`                                               | `Tooltip.tsx`                               | `text-caption1 bg-surface-secondary rounded-utility border shadow-modal px-2 py-1 max-w-56`, ~500ms delay                                                                                                                                                                                                            |
| `input.tsx`, `textarea.tsx`, `input-group.tsx`, `label.tsx` | `Input.tsx`, `Textarea.tsx`, `Field.tsx`    | `rounded-utility border bg-surface-secondary px-3 py-2 text-body2`; `aria-invalid` → danger border                                                                                                                                                                                                                   |
| `switch.tsx`, `checkbox.tsx` (from `BZ/shared/ui`)          | `Switch.tsx`, `Checkbox.tsx`                | checked `bg-accent-brand`                                                                                                                                                                                                                                                                                            |
| `segmented-control.tsx` (from `BZ/shared/ui`)               | `SegmentedControl.tsx`                      | `rounded-utility bg-surface-secondary p-0.5`; active `bg-surface-primary shadow-button`                                                                                                                                                                                                                              |
| `spinner.tsx`, `skeleton.tsx`                               | `Spinner.tsx`                               | sizes 4/6                                                                                                                                                                                                                                                                                                            |
| `kbd.tsx` (new)                                             | `Kbd.tsx`                                   | `text-caption2 bg-kbd-background rounded-utility`                                                                                                                                                                                                                                                                    |
| `sidebar.tsx`                                               | replaced by `BZ/shared/ui/sidebar.tsx` (W2) |                                                                                                                                                                                                                                                                                                                      |

Add from `BZ/shared/ui/` (copy, then re-skin): `alert-dialog`, `context-menu`, `segmented-control`, `switch`, `checkbox`, `toggle`, `UnreadPill`, `InlineChip`, `Shimmer`, `AnimatedCount`, `VirtualizedList`, `SimpleImageLightbox`, `ViewLoadingFallback`, `PanelSectionGroup`. Use `BZ/shared/lib/cn.ts` (tailwind-merge extension) as `src/lib/utils.ts` `cn`; register the design-system font-size and radius classes in its `extendTailwindMerge` config instead of Buzz's `text-message`/`rounded-squircle`.

### 3.5 Class rewrite table for every file copied from `BZ`

| Buzz class / token                                             | Replace with                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `text-message`                                                 | `text-body2`                                                    |
| `text-message-timestamp`, `text-2xs`, `text-3xs`, `text-badge` | `text-caption1` / `text-caption2`                               |
| `text-title`                                                   | `text-subtitle font-heading`                                    |
| `text-xs` / `text-sm` / `text-base` / `text-lg`                | `text-caption1` / `text-body2` / `text-body1` / `text-subtitle` |
| `rounded-squircle`, `rounded-md`, `rounded-lg`                 | `rounded-utility` (controls) / `rounded-card` (cards)           |
| `rounded-full` on chips/pills                                  | `rounded-pill` (keep `rounded-full` on avatars and dots)        |
| `bg-white`, `bg-black`, `text-white` on media overlays         | `bg-glass-surface`, `bg-glass-inverse`, `text-text-inverse`     |
| `bg-amber-*`, `text-amber-*`                                   | `bg-accent-warning(-transparent)`, `text-accent-warning`        |
| `bg-emerald-*`, `bg-green-*`, `text-green-*`                   | `accent-success` tokens                                         |
| `bg-red-*`, `text-red-*`                                       | `accent-danger` tokens                                          |
| `bg-blue-*`                                                    | `accent-brand` tokens                                           |
| `var(--conversation-*)`, `--buzz-type-rem`                     | delete; use the type scale (§3.2) + Tailwind spacing                  |
| `data-buzz-*` attributes                                       | delete or rename `data-fab-*` only when CSS targets them        |
| raw hex in TSX                                                 | token class; if none fits → stop, raise O3                      |

### 3.6 Guard script

`packages/web/scripts/check-design.sh`, run in `pnpm -C packages/web lint` and CI. Fails on matches in `src/**/*.{ts,tsx}` excluding `styles/`, `components/brand/colors.ts`, tests:

- `#[0-9a-fA-F]{3,8}\b` in class strings or style props
- `\b(bg|text|border|ring|fill|stroke)-(zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d`
- `var\(--fab-` outside `styles/`
- `from ["']lucide-react["']` outside `components/icons/index.ts`
- `@tauri-apps/`, `nostr-tools`
- `aqua|jan3` case-insensitive in all of `packages/web` (`src/`, `index.html`, `public/`, CSS, `package.json`, `README.md`). No exclusions

### 3.7 Acceptance W1

- `pnpm -C packages/web build test typecheck` green.
- Storybook story `Foundations/Tokens` renders every semantic token and Fabrium token in both themes.
- One vitest test asserts `getComputedStyle(html).getPropertyValue('--background')` resolves to `--surface-background` value in both `data-theme` values.
- `check-design.sh` passes on the whole `src/`.

## 4. Buzz copy inventory

Class: **P** copy as-is (then §3.5 rewrite) · **A** copy, replace Buzz types/imports with props and `src/model/types.ts` · **R** do not copy code; rebuild the pattern on `ZW` hooks.

Global stubs needed before copying any `BZ` file:

- `BZ/shared/lib/mediaUrl.ts` `rewriteRelayUrl` → replace every call with `ZW/lib/matrix/authed-media.ts` `useAuthedMediaUrl(mxc)`.
- `BZ/shared/lib/pubkey.ts`, `initials.ts` (nostr-tools) → `src/lib/sender.ts` (`ZW`) helpers; write `initials(name)` in `src/lib/sender.ts` if missing.
- `UserProfileLookup` / `pubkey` fields → `actorId` (Matrix user ID) + `ActorSummary` (§5).

### 4.1 Shell and layout (W2)

| BZ source                                                                                                                            | Class | Target                                                                              | Adapt                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------- |
| `app/AppShell.tsx` (lines ~751–1003)                                                                                                 | R     | `components/structures/logged-in-view.tsx`                                          | Rebuild composition: rail · sidebar · inset(header, timeline, composer) · right aux pane. Drop huddle shell, relay overlay, tray, updater                  |
| `features/sidebar/ui/CommunityRail.tsx`                                                                                              | A     | `components/structures/workspace-rail.tsx`                                          | Items = `useJoinedSpaces()` top-level spaces; unread from `useSpaceUnread`. Drop dnd-kit reorder, relay membership lookup                                  |
| `shared/ui/sidebar.tsx`                                                                                                              | A     | `components/ui/sidebar.tsx` (replace `ZW` one)                                      | Keep pointer-drag resize + 300px detent; storage key `fabrium:sidebar-width`. Remove `BuzzThemeSurfaces` and glass inset styling                           |
| `features/sidebar/ui/AppSidebar.tsx`                                                                                                 | R     | `components/structures/sidebar/sidebar.tsx` (`ZW`)                                  | Keep `ZW` data (sections: favourites, project subspaces, rooms, DMs, invites). Take Buzz visual layout                                                     |
| `features/sidebar/ui/SidebarSection.tsx`, `CustomChannelSection.tsx`, `sidebarSectionStyles.ts`, `sidebarLoadingSkeleton.tsx`        | A     | `components/structures/sidebar/section.tsx`, `room-row.tsx`, `sidebar-skeleton.tsx` | Props from `ZW` `section.tsx`/`room-row.tsx`. Drop custom sections + DnD (Backlog)                                                                         |
| `features/sidebar/ui/ChannelContextMenu.tsx`                                                                                         | A     | `components/structures/sidebar/room-context-menu.tsx`                               | Actions: favourite (`useRoomFavorite`), notification state (`useRoomNotifState`), mark read (`useMarkRead`), leave, copy link (`lib/matrix/permalinks.ts`) |
| `features/sidebar/ui/MoreUnreadButton.tsx`                                                                                           | A     | `components/structures/sidebar/more-unread-button.tsx`                              | Unread from `useSectionUnread`                                                                                                                             |
| `features/sidebar/ui/SidebarProfileCard.tsx`                                                                                         | A     | sidebar footer                                                                      | Use `user-avatar.tsx`, `usePresence`, settings + logout menu from `ZW` footer                                                                              |
| `app/AppTopChrome.tsx`                                                                                                               | A     | `components/structures/top-bar.tsx`                                                 | Keep search trigger only. Drop Tauri drag regions, back/forward, traffic-light insets (`shared/layout/chromeLayout.ts`)                                    |
| `shared/layout/AuxiliaryPanelShell.tsx`, `AuxiliaryPanelHeader.tsx`, `AuxiliaryPanelBody.tsx`, `shared/hooks/useThreadPanelWidth.ts` | P     | `components/layout/aux-panel-*.tsx`, `hooks/use-aux-panel-width.ts`                 | Storage key `fabrium:aux-width`                                                                                                                            |
| `shared/layout/MainInsetContext.tsx`, `useMeasuredCssVariable.ts`                                                                    | P     | `components/layout/`                                                                | Only if copied components need them                                                                                                                        |
| `features/channels/ui/RightAuxiliaryPane.tsx`                                                                                        | A     | `components/structures/right-pane.tsx`                                              | Views: `thread`, `members`, `profile`, `room-info`, `notifications` (merge `ZW` `room-panel.tsx` views). URL: `?thread=` keeps contract; `?pane=members    | profile:<id> | info` new |
| `shared/hooks/use-mobile.tsx`                                                                                                        | P     | merge into `hooks/use-mobile.ts` (`ZW`)                                             | Below `md`: sidebar = sheet, right pane = full-screen overlay                                                                                              |
| `shared/lib/keyboard-shortcuts.ts`, `app/useAppShellKeyboardShortcuts.ts`                                                            | P / A | `lib/keyboard-shortcuts.ts`, `hooks/use-app-shortcuts.ts`                           | Keep: ⌘K switcher, ⌘/ search, Alt+↑/↓ room, Esc close pane, ⇧Esc mark all read. Drop zoom/reload/close-window                                              |

Routes added: none required. `/` index keeps `LobbyRoute` (`ZW`) restyled.

### 4.2 Channel header (W2)

| BZ source                                                   | Class | Target                                        | Adapt                                                                                                                             |
| ----------------------------------------------------------- | ----- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `features/chat/ui/ChatHeader.tsx`                           | A     | `components/structures/room-header.tsx`       | Merge with `ZW` `room-header.tsx` data (name, `useRoomTopic`, `member-stack.tsx`, panel toggles). Remove `UpdateIndicator` import |
| `features/channels/ui/ChannelScreenHeader.tsx`              | A     | same                                          | Member bar → `ZW` `member-stack.tsx`; agent markers from `useWorkforce`                                                           |
| `features/channels/ui/ChannelGlyph.tsx`                     | A     | `components/room-glyph.tsx`                   | Glyph by `RoomKind` (§5): `#` stream, lock private, DM avatar, agent DM badge. Drop projects hook                                 |
| `ChannelHeaderStatusBadge.tsx`, `EphemeralChannelBadge.tsx` | A     | `components/structures/room-status-badge.tsx` | Show `archived` (tombstone) and E2EE state only                                                                                   |
| `ChannelMemberAvatarStack.tsx`                              | R     | —                                             | Use `ZW` `member-stack.tsx`                                                                                                       |

### 4.3 Timeline (W3)

| BZ source                                                                                                                                                                                                                   | Class | Target                                                      | Adapt                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/messages/ui/TimelineMessageList.tsx`                                                                                                                                                                              | A     | `components/timeline/timeline-list.tsx`                     | `virtua` `VList`; input `TimelineEntry[]` (§5); day groups                                                                                                                 |
| `features/messages/ui/MessageTimeline.tsx`                                                                                                                                                                                  | A/R   | `components/structures/timeline-panel.tsx` (replace `ZW`)   | Data: `useTimeline`, `useLoadMoreHistory`, `useFillGap`, `useMarkRead`. Keep `ZW` gap markers (`timeline-gap.tsx`) and `?event=` highlight                                 |
| `useAnchoredScroll.ts`, `anchoredScrollPolicy.ts`, `useLoadOlderOnScroll.ts`, `useUpwardPaginationWheel.ts`, `useVirtualizedBottomSettle.ts`, `useSettleGatedPrependMessages.ts` (all in `features/messages/ui/` or `lib/`) | P     | `hooks/timeline/*`                                          | Copy with tests if present                                                                                                                                                 |
| `features/messages/lib/messageGrouping.ts`, `timelineItems.ts`, `threadPanel.ts`, `threadTreeLayout.ts`                                                                                                                     | A     | `lib/timeline/*`                                            | Replace `KIND_*` constants with `TimelineMessage.kind` (§5). Keep `buildMainTimelineEntries` + thread summaries                                                            |
| `features/messages/lib/formatTimelineMessages.ts`                                                                                                                                                                           | R     | `src/model/from-matrix.ts`                                  | Rewrite: `MatrixEvent[]` → `TimelineMessage[]` using `ZW` `lib/matrix/edits.ts`, `useReactions` logic, `m.thread` relations, `lib/matrix/quote.ts`, `events/*` decoders    |
| `TimelineMessageRow.tsx`, `TimelineRowShell.tsx`                                                                                                                                                                            | A     | `components/timeline/timeline-row.tsx`                      | Dispatch by `TimelineMessage.kind`: `message`, `membership`, `agent-activity`, `approval`, `question`, `error`, `gap`, `divider` (replaces `ZW` `event-tile.tsx` dispatch) |
| `DayDivider.tsx`, `UnreadDivider.tsx`                                                                                                                                                                                       | P     | `components/timeline/day-divider.tsx`, `unread-divider.tsx` | Replace `ZW` `date-divider.tsx`                                                                                                                                            |
| `TimelineSkeleton.tsx`, `MessageTimelineErrorCard.tsx`, `ChannelIntroBlock.tsx`, `DirectMessageIntroAvatarStack.tsx`                                                                                                        | P/A   | `components/timeline/*`                                     | Intro replaces `ZW` `room-intro.tsx`; skeleton storage key `fabrium:`                                                                                                      |
| `shared/ui/UnreadPill.tsx`                                                                                                                                                                                                  | P     | "N new messages" jump pill                                  |                                                                                                                                                                            |

### 4.4 Message row and actions (W3)

| BZ source                                                                                                                         | Class | Target                                                      | Adapt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/messages/ui/MessageRow.tsx`                                                                                             | A/R   | `components/timeline/message-row.tsx`                       | Copy layout (avatar gutter, compact continuation rows, hover state, highlight). Remove direct imports: `shared/api/tauri` `editMessage`, `useKnownAgentPubkeys`, `HuddleAttachment`, `useRemindLater`, `parseImetaTags`, `ProtectedMessageAction`. All actions via props: `onReply`, `onEdit`, `onDelete`, `onToggleReaction`, `onOpenThread`, `onShare`, `onCopyLink`, `onMarkUnread` (drop if no API). Body → `ZW` `formatted-message-body.tsx` + `truncated-body.tsx`; media → `ZW` `media-message.tsx` restyled; quote → `ZW` `quote-card.tsx` |
| `MessageHeader.tsx`, `MessageAuthorWithIndicators.tsx`, `MessageTimestamp.tsx`, `MessageAgentOwner.tsx`, `SentFromThreadLine.tsx` | A     | `components/timeline/message-header.tsx` etc.               | Author label + actor badge (§6.1). Timestamp formatting from `ZW` `lib/time.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `MessageActionBar.tsx`                                                                                                            | A/R   | `components/timeline/message-action-bar.tsx`                | Keep: quick reactions, emoji picker, reply in thread, edit (own), delete (own / power level from `useMyPowerLevel`), share (`ZW` `dialogs/share-message.tsx`), copy link. Drop: moderation, report, remind later, custom emoji, GIFs                                                                                                                                                                                                                                                                                                               |
| `MessageReactions.tsx`, `useReactionHandler.ts`                                                                                   | A     | `components/timeline/reactions-row.tsx` (replace `ZW`)      | Data: `useReactions(roomId, eventId)` → `TimelineReaction[]`. Users tooltip via `useUserName`. Drop `emojiUrl`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `features/custom-emoji/ui/EmojiPicker.tsx`                                                                                        | A     | `components/timeline/reaction-picker.tsx` (merge with `ZW`) | emoji-mart only; theme from `data-theme`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DeleteMessageConfirmDialog.tsx`                                                                                                  | P     | `components/timeline/delete-confirm-dialog.tsx`             | Replaces delete confirm in `ZW` `message-actions.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ComposerReplyEditBanner.tsx`, `submitMessageEdit.ts`                                                                             | A     | inline edit (keep `ZW` edit flow in `message-actions.tsx`)  | Edits send `m.replace` (`ZW`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `SystemMessageRow.tsx`                                                                                                            | R     | `components/timeline/system-row.tsx`                        | Render `ZW` `membership-event.tsx` + room state changes in Buzz compact style                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ZW` `read-receipts-row.tsx`, `send-state.tsx`, `message-link.tsx`                                                                | keep  | restyle                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 4.5 Threads (W4)

| BZ source                                                                                                              | Class | Target                                                                                       | Adapt                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/messages/ui/MessageThreadPanel.tsx`                                                                          | A/R   | `components/structures/thread-pane.tsx` (replaces `ZW` `thread-view.tsx` main-area takeover) | Opens in right pane from `?thread=`. Data: `useThread`, `useLoadMoreThread`, `usePlan`. Composer instance bound to thread root. Keep `PlanBoard` above thread composer |
| `MessageThreadRow.tsx`, `MessageThreadSummaryRow.tsx`, `MessageThreadReplyState.tsx`, `MessageThreadPanelSkeleton.tsx` | A/P   | `components/timeline/thread-summary-row.tsx`, `thread-pane-*.tsx`                            | Summary data: `useThreadPreview` (count, last ≤3 participants)                                                                                                         |
| nested-thread depth guides (`threadTreeLayout.ts`)                                                                     | —     | skip                                                                                         | Matrix threads are flat                                                                                                                                                |
| `FocusThreadDrawer.tsx`, `ThreadViewModeToggle.tsx`                                                                    | A     | Backlog                                                                                      | Mobile uses full-screen pane instead                                                                                                                                   |

### 4.6 Composer (W4)

| BZ source                                                                                                                             | Class     | Target                                                                    | Adapt                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/messages/ui/MessageComposer.tsx`                                                                                            | R         | `components/rooms/composer.tsx` (`ZW`, keep)                              | Keep `ZW` send orchestration (threads, slash commands, quote, attachments, stop button, failed sends). Swap input to TipTap editor                                                                                                                             |
| `features/messages/lib/useRichTextEditor.ts`, `mentionHighlightExtension.ts`, `codeBlockExtensions.ts`, `linkInteractionExtension.ts` | A         | `components/rooms/editor/*`                                               | Deps: `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`, `tiptap-markdown`. Replace Tauri clipboard read with `navigator.clipboard`. Drop `customEmojiNode.ts`, `spoilerMark.ts` |
| `FormattingToolbar.tsx`, `SelectionFormattingTray.tsx`, `ComposerDockToolbar.tsx`                                                     | A         | `components/rooms/editor/*`                                               | `IconButton` (§3.4)                                                                                                                                                                                                                                              |
| `MentionAutocomplete.tsx`                                                                                                             | A         | `components/rooms/mention-autocomplete.tsx`                               | Candidates: `useMembers(roomId)` + `useWorkforce` agents first. Output Matrix pill `https://matrix.to/#/<userId>` + `m.mentions.user_ids`                                                                                                                      |
| `ChannelAutocomplete.tsx`                                                                                                             | A         | `components/rooms/room-autocomplete.tsx`                                  | `#` → `useRoomList()`; output `matrix.to` room link                                                                                                                                                                                                            |
| `EmojiAutocomplete.tsx`                                                                                                               | A         | `components/rooms/emoji-autocomplete.tsx`                                 | `:shortcode` via `@emoji-mart/data`                                                                                                                                                                                                                            |
| slash commands                                                                                                                        | keep `ZW` | `lib/slash-commands.ts`, `slash-command-list.tsx`, `useAvailableCommands` | Re-skin list in Buzz autocomplete style                                                                                                                                                                                                                        |
| `ComposerAttachments.tsx`, `ComposerUploadProgressPill.tsx`                                                                           | A         | replace `ZW` `staged-attachments.tsx`                                     | Upload via `ZW` `useMediaUpload` (max 0.5 MB, keep limit) ; drop `ImetaMedia`, Blossom                                                                                                                                                                         |
| `VoiceNoteRecorder.tsx`, `ComposerImageEditor.tsx`, `ComposerEmojiPicker.tsx` (GIFs)                                                  | —         | skip                                                                      |                                                                                                                                                                                                                                                                |
| `features/messages/ui/TypingIndicatorRow.tsx`                                                                                         | A         | `components/rooms/typing-indicator.tsx` (replace `ZW`)                    | Data: `useTyping`, `useAwaitingInput` ("Coder · Payments is waiting for your input"). Replace `truncateNpub` with `useUserName`                                                                                                                                    |
| Send format                                                                                                                           | —         | —                                                                         | `body` = markdown from `tiptap-markdown`; `format: org.matrix.custom.html`; `formatted_body` = `marked` + DOMPurify (same pipeline as render)                                                                                                                  |

### 4.7 People, presence, profile (W6)

| BZ source                                                           | Class | Target                                                                              | Adapt                                                                                                                                                                            |
| ------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------ | ---- | -------- |
| `features/presence/ui/PresenceBadge.tsx`                            | A     | `components/presence-dot.tsx`; use in `user-avatar.tsx`                             | `usePresence(userId)` → `online                                                                                                                                                  | unavailable | offline`mapped to`online | away | offline` |
| `features/channels/ui/MembersSidebar.tsx`                           | R     | `components/structures/member-panel.tsx` (`ZW`, keep virtualized + grouped by role) | Visual from Buzz; groups: Humans by role (owner/admin/manager/member/guest from power levels via `lib/roles.ts`), then Agents                                                    |
| `MembersSidebarMemberCard.tsx`, `AddMemberSearchResultRow.tsx`      | A     | `member-row.tsx`, `dialogs/invite-user.tsx`                                         |                                                                                                                                                                                  |
| `features/profile/ui/UserProfilePopover.tsx`                        | R     | `components/user-profile-popover.tsx`                                               | Small rebuild: avatar, name, actor badge, presence, "Message" (create DM via `dialogs/create-dm.tsx` logic), for agents: persona, project, rooms from roster `RosterAgent.rooms` |
| `features/profile/ui/ProfileAvatar.tsx`, `shared/ui/UserAvatar.tsx` | A     | merge into `ZW` `user-avatar.tsx`                                                   | Keep dicebear fallback; add agent avatar frame (square `rounded-utility`) vs human (circle)                                                                                      |
| `features/agents/ui/AgentIdentityCard.tsx`, `AgentStatusBadge.tsx`  | A     | `components/agents/agent-card.tsx`, `agent-status-badge.tsx`                        | Status from active turn (§4.8)                                                                                                                                                   |

### 4.8 Agent UI (W5)

Zooid events (`ZW/src/events/zooid-events.ts`) are ACP-derived; Buzz transcript renderers consume ACP observer events. Map, do not re-decode.

| BZ source                                                                                                                                                    | Class | Target                                               | Adapt                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----- | ------- | ------------------------- |
| `features/agents/ui/agentSessionTypes.ts`                                                                                                                    | A     | `src/model/agent-activity.ts`                        | Keep `TranscriptItem`, `ToolStatus`; drop `ObserverEvent`                                                                                                                                                                                                                                                              |
| new                                                                                                                                                          | —     | `src/model/from-zooid.ts`                            | `DecodedZooidEvent[]` (per thread/session) → `TranscriptItem[]`: `tool_call` + folded `tool_call_update` → tool item (status, diffs, content, rawInput); `plan` → plan item; `agent_message_chunk` → message item; `turn.start`/`turn.end` → lifecycle; `error` → error item. Use `ZW` `useToolCallStatus` merge rules |
| `features/agents/ui/agentSessionToolClassifier.ts`, `agentSessionToolCatalog.ts`, `agentSessionToolSummary.ts`, `agentSessionTranscriptGrouping.ts`          | P     | `lib/agent-activity/*`                               | Map Zooid `toolKind` (`edit                                                                                                                                                                                                                                                                                            | read | fetch | execute | …`) into classifier input |
| `activityRenderClasses/TranscriptActivityItem.tsx`, `MessageActivity`, `ToolActivity`, `ThoughtActivity`, `PlanActivity`, `LifecycleActivity`, `ActivityRow` | A     | `components/agents/activity/*`                       | Replaces `ZW` `zooid-event.tsx` `ToolCallCard`. Diffs → `ZW` `diff-view.tsx`. Visual: `HV/components/chat/ToolCallGroup.tsx` (disclosure, chevron 90°, `rounded-card bg-surface-secondary`, output `text-caption1 font-mono max-h-60`), `ReasoningPanel.tsx` (left rail)                                               |
| `AgentSessionToolItem/ToolItem.tsx`, `ShellCommandBlock.tsx`, `ToolDetailBlocks.tsx`, `TodoToolSummary.tsx`, `CompactToolSummaryRow.tsx`                     | A     | `components/agents/activity/tool-*.tsx`              | Keep `ZW` "stalled" staleness tick                                                                                                                                                                                                                                                                                     |
| `features/agents/ui/AgentSessionTranscriptList.tsx`                                                                                                          | A/R   | `components/agents/activity/turn-block.tsx`          | One collapsible block per agent turn in the timeline/thread: header "Coder · Payments used 6 tools · 42s", expanded list of items. Collapsed by default when turn ended                                                                                                                                                    |
| `features/channels/ui/BotActivityBar.tsx`                                                                                                                    | R     | `components/rooms/agent-activity-bar.tsx`            | Above composer: agents with open turn (`turn.start` without `turn.end`) + current tool title; stop button → `dev.zooid.interrupt` (`ZW` composer)                                                                                                                                                                      |
| `features/agents/ui/TurnLivenessIndicator.tsx`                                                                                                               | P     | `components/agents/turn-liveness.tsx`                |                                                                                                                                                                                                                                                                                                                        |
| `features/workflows/ui/WorkflowApprovalCard.tsx`                                                                                                             | A     | merge into `ZW` `approval-card-view.tsx`             | Keep `ZW` `useApproval` logic. Show: tool title, input preview, option buttons, resolved state with responder name + time, error state. Human-only action: hide buttons for agents                                                                                                                                     |
| `ZW` `question-card-view.tsx`, `plan-board.tsx`, `error-tile.tsx`, `diff-view.tsx`                                                                           | keep  | restyle with re-skinned primitives (Callout, Card, Button) |                                                                                                                                                                                                                                                                                                                        |
| `features/pulse/ui/AgentActivityCard.tsx`, `NoteCard.tsx`, `PulseView.tsx`                                                                                   | —     | Backlog (agent notes feed, `FB` §9.6)                | No backend                                                                                                                                                                                                                                                                                                             |
| `AgentDialog.tsx`, `AgentDefinitionDialog.tsx`, `ModelPicker.tsx`, Tauri managed agents                                                                      | —     | skip                                                 | Agents are declared in `zooid.yaml` today                                                                                                                                                                                                                                                                              |

### 4.9 Search, switcher, inbox (W6)

| BZ source                                                                                                                                                                      | Class | Target                                          | Adapt                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/search/ui/TopbarSearch.tsx`                                                                                                                                          | A/R   | `components/search/top-search.tsx`              | Popover results under top bar. Data: new `hooks/use-message-search.ts` (`client.searchRoomEvents`, _verify_ Tuwunel support) + `ZW` `usePublicRooms` for rooms. Keep `/search` page (`ZW`) as full results view                                                                  |
| `SearchResultItem.tsx`, `HighlightedSearchText.tsx`, `SearchScopeControls.tsx`, `useSearchMenuKeyboardNavigation.ts`                                                           | A     | `components/search/*`                           |                                                                                                                                                                                                                                                                                  |
| `features/search/lib/parseSearchOperators.ts`, `lib/searchMatch.ts`                                                                                                            | P     | `lib/search/*`                                  | Supported operators: `in:#room`, `from:@user` → Matrix filter                                                                                                                                                                                                                    |
| quick switcher                                                                                                                                                                 | —     | `ZW` `dialogs/room-picker.tsx` (cmdk)           | Bind ⌘K; rows use `room-glyph.tsx` + unread                                                                                                                                                                                                                                      |
| `features/home/ui/HomeView.tsx`, `InboxListPane.tsx`, `InboxMessageRow.tsx`, `InboxDetailPane.tsx`, `FeedSection.tsx`, `useResizableInboxListWidth.ts`, `HomeLoadingState.tsx` | A/R   | `components/structures/inbox/*`, route `/inbox` | Categories: `needs_action` = open approvals + open elicitations across joined rooms (scan with `ZW` decoders); `mention` = highlight events (Matrix `/notifications` API, _verify_ Tuwunel); `activity` = threads I follow with new replies. Drop `agent_activity` until Backlog |

### 4.10 Settings and dialogs (W6)

| Source                                                                          | Target                                       | Adapt                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- | ----- | -------------------------------------------------- |
| `BZ features/settings/ui/AppearanceSettingsControls.tsx`                        | `components/settings/appearance-section.tsx` | Theme `system                                                                    | light | dark` only. Drop density/font size until requested |
| `HV components/settings/AppearanceSection.tsx`                                  | same                                         | visual reference                                                                 |
| `ZW` `settings-dialog.tsx`, `profile-section.tsx`, `notification-section.tsx`   | keep                                         | restyle                                                                          |
| `BZ features/channels/ui/ChannelBrowserDialog.tsx`                              | `components/dialogs/browse-rooms.tsx`        | Data: `useSpaceHierarchy`, `useJoinRoom` (merge with `ZW` `lobby.tsx` join flow) |
| `BZ features/sidebar/ui/CreateChannelDialog.tsx`, `CreateChannelFormFields.tsx` | `components/dialogs/create-room.tsx` (`ZW`)  | Keep `ZW` creation logic; take Buzz form layout                                  |
| `ZW` `dialogs/create-dm.tsx`, `invite-user.tsx`, `share-message.tsx`            | keep                                         | restyle                                                                          |
| `ZW` `auth/login.tsx`, `register.tsx`                                           | keep                                         | Re-layout: centered card, Fabrium wordmark (`components/brand/logo.tsx`), pill buttons                    |

### 4.11 Skip list (never copy)

`BZ`: `shared/api/**`, `features/terminal/**`, `features/huddle/**`, `features/local-archive/**`, `features/mesh-compute/**`, `features/projects/**`, `features/forum/**`, `features/reminders/**`, `features/user-status/**`, `features/communities/*` sync, `features/notifications/lib/desktop.ts`, `features/settings/UpdateChecker.tsx|UpdateIndicator.tsx|SidebarUpdateCard.tsx`, `shared/ui/StartupWindowDragRegion.tsx`, `app/useTauriWindowDrag.ts`, `app/useTrayMenu.ts`, `useAppShellTrayMenu.tsx`, `useWebviewZoomShortcuts.ts`, `useCloseWindowShortcut.ts`, `useReloadShortcut.ts`, `shared/hooks/useWebviewScrollBoundaryLock.ts`, `shared/ui/markdown/ExternalLinkAnchor.tsx`, `shared/theme/**` (ThemeProvider, adaptive-theme, theme-loader, vibrancy), `app/BuzzThemeSurfaces.tsx`, `CommunityThemeController.tsx`, `protectedFeatures/**`, `desktop/public/pow/**` (MIT, Emerge Tools), onboarding keypair flows.

`HV`: Next.js files (`app/**` route handlers, `next/*` imports, `"use client"`), `lib/i18n/**` (no i18n in this package), markdown Web Worker, artifacts panel.

## 5. View model (`src/model/types.ts`)

Adapted from `BZ features/messages/types.ts`, `shared/api/types.ts`, and `FB` §5.1 envelope. `pubkey` → `actorId`.

```ts
export type ActorKind = "human" | "agent" | "system";
export interface ActorSummary {
  id: string; // Matrix user ID
  kind: ActorKind;
  displayName: string; // agents: "Persona · Project" (§6.1)
  avatarUrl: string | null; // mxc; resolve with useAuthedMediaUrl
  persona?: string; // agents only
  project?: string; // agents only
}
export type RoomKind = "stream" | "forum" | "dm" | "release" | "task" | "sealed"; // FB §4; from dev.fabrium.channel state, fallback stream/dm
export interface RoomSummary {
  id: string;
  name: string;
  kind: RoomKind;
  topic: string | null;
  isPrivate: boolean;
  isEncrypted: boolean;
  archived: boolean;
  parentId: string | null; // space (project) or parent room (Backlog nesting)
  unread: { total: number; highlight: number };
  memberCount: number;
}
export interface TimelineReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  myEventId?: string;
  actorIds: string[];
}
export type TimelineKind =
  | "message"
  | "membership"
  | "state"
  | "agent-turn"
  | "approval"
  | "question"
  | "error"
  | "gap";
export interface TimelineMessage {
  id: string;
  kind: TimelineKind;
  createdAt: number;
  author: ActorSummary;
  body: string;
  formattedBody?: string; // sanitized at render
  threadRootId: string | null; // m.thread
  replyToId: string | null; // m.in_reply_to
  quoteOf?: string; // dev.zooid.quote
  edited: boolean;
  pending: boolean;
  failed: boolean;
  redacted: boolean;
  reactions: TimelineReaction[];
  media?: {
    mxc: string;
    mimetype: string;
    name: string;
    size?: number;
    w?: number;
    h?: number;
  };
  raw?: unknown; // decoded Zooid payload for agent-turn/approval/question/error
}
export interface ThreadSummary {
  rootId: string;
  replyCount: number;
  lastReplyAt: number | null;
  participants: ActorSummary[];
}
export interface TimelineEntry {
  message: TimelineMessage;
  thread: ThreadSummary | null;
}
```

`src/model/from-matrix.ts` exports: `toActor(userId, room, roster)`, `toRoomSummary(room)`, `toTimelineMessages(events, room, roster)`, `toThreadSummary(root, room)`. Pure functions. One vitest file `from-matrix.test.ts` using `ZW` `test/factories.ts`.

New hooks wrap `ZW` hooks + mappers: `useTimelineEntries(roomId)`, `useThreadEntries(roomId, rootId)`, `useRoomSummaries(scope)`, `useActor(userId, roomId?)`. Components consume only these.

## 6. Fabrium spec rules applied to UI (from `FB`)

### 6.1 Identity

- Actors: `human`, `agent`, `system` (`FB` §2.2 "Agents are actors, not bots"). Agent = `useWorkforce(spaceId).isAgent(userId)`. System = appservice sender localpart / integration bots (list in `from-matrix.ts`).
- Agent display name: `Persona · Project` (e.g. `Coder · Payments`) (`FB` §9.3). Daemon roster today publishes only `{user_id, name, rooms}` (`packages/transport-matrix/src/workforce-publisher.ts` `WorkforceRoster`). W5 task: add optional `persona` and `project` to `WorkforceRoster` + `WorkforceEntry` (+ test), sourced from agent config in `zooid.yaml`. UI label: `persona ?? name` · `project ?? workforce space name`.
- Every agent message shows a badge chip (tone `agent`) next to the name. Humans: no badge. System: chip tone `system`.
- Member list and agent pickers group agents by persona ("five QA agents read as one role", `FB` §9.3).

### 6.2 Trust and approvals

- Approval buttons visible to humans only. Agents cannot approve (`FB` §14, design.html "Agent reviews never count as human reviews").
- Resolved approval shows responder name, decision, time. Timeout = denied state (`FB` §14).
- Agent-authored pending content (Backlog: suggestions, notes, task bodies) is visibly marked `pending`/`unreviewed` until a human acts (`FB` §16.4, §9.6). Use chip tone `warning` + dashed border.
- Untrusted content origins: media via authed media blob URLs only (`ZW`); never render agent HTML unsanitized; never embed previews in the client origin (`FB` §16.8, §17).
- Never display secret values (`FB` §15.3).

### 6.3 Terminology for UI copy

Use: workspace, project, channel, room, thread, task room, release channel, canvas, decision, approval, agent, persona, manager, huddle. Do not use: space (in UI copy), bot, server, guild. Roles: owner, admin, manager, member, guest. Sentences: plain technical English, short, active voice (`fabrium/plain-technical`). Tooltip copy for terms: `FB` architecture.html glossary (lines ~6235–6276).

### 6.4 Fabrium → Matrix mapping

Status: `now` = works with Zooid today · `ext` = custom event, add when the backend sends it · `api` = Fabrium service API (§6.5).

| Fabrium (`FB`) | Matrix mechanism | Status |
| --- | --- | --- |
| workspace | top-level space (`workforce_space`) = rail item; one homeserver per workspace for tenant isolation | now |
| project | child space of the workspace = sidebar section | now |
| channel `stream` | room in the project space | now |
| channel `dm` | `m.direct` room | now |
| channel `release`, `task` | room as child of the project space (task room: child of the release room via `m.space.child`); kind in `dev.fabrium.channel` state | ext |
| channel `forum` | room whose top-level messages are thread roots; kind in `dev.fabrium.channel` state | ext |
| channel `sealed` | room with `m.room.encryption` (Megolm); no server search, no agents | ext |
| archived channel | `m.room.tombstone` or `dev.fabrium.channel` `archived: true`; stays readable and searchable | ext |
| git binding (repo, branch, PR) | `dev.fabrium.channel` state fields `repo`, `branch`, `pr` | ext |
| roles owner/admin/manager/member/guest | power levels. `ZW` `lib/roles.ts` has admin 100 / moderator 50 / default 0. Extend to owner 100, admin 90, manager 50 (replaces moderator), member 0; guest = member of the room but not of the project space | ext |
| project permissions `haven.assign`, `agents.create`, `agents.manage` | service API | api |
| message, edit, delete, reaction, thread | `m.room.message`, `m.replace`, redaction, `m.annotation`, `m.thread` | now |
| typing, presence, read receipts | `m.typing`, presence, `m.receipt` | now |
| decision (`/decide`, decision reaction) | `dev.fabrium.decision` message event with `m.reference` to the message; sender must be human | ext |
| agent | appservice user in `dev.zooid.workforce` roster (+ `persona`, `project`, §6.1) | now |
| agent turn, tool call, plan, error | `dev.zooid.*` events | now |
| approval | `dev.zooid.approval_request` / `_response`; Fabrium additions (timeout, pinned canvas version) as extra fields | now / ext |
| agent question | `dev.zooid.elicitation_*` | now |
| manager commands `/agent …` | `dev.fabrium.agent_command` message event; the daemon consumes it | ext |
| per-room agent settings (`respond_policy`, instructions) | `dev.fabrium.agent_settings` state, `state_key` = agent user ID | ext |
| task | `dev.fabrium.task` state in the task room (status, assignee, parent, branch) | ext |
| canvas | `dev.fabrium.canvas` state = head (version, sha256, body or `mxc` if > 48 KB); `dev.fabrium.canvas.edit` / `.suggestion` message events; accept/reject with `m.reference` | ext |
| release | `dev.fabrium.release` state in the release room | ext |
| GitHub, CI, preview, notes-in-room events | `dev.fabrium.github.*`, `dev.fabrium.ci.*`, `dev.fabrium.preview` message events sent by the service user | ext |
| media, agent files | authenticated media (`ZW` `lib/matrix/authed-media.ts`) | now |
| huddle | MatrixRTC (`m.call.member` state, LiveKit via `.well-known` `rtc_foci`) | ext |
| search | `/search` (server side; encrypted rooms excluded) | now *(verify Tuwunel, O5)* |
| mentions inbox | `/notifications` | now *(verify Tuwunel, O5)* |
| agent directory, directives, budgets, usage, Haven accounts, catalog, notes review feed, audit export, attestation | service API | api |

### 6.5 Matrix extension rules

- Namespace: new types are `dev.fabrium.<name>` (state) or `dev.fabrium.<domain>.<name>` (message). Keep existing `dev.zooid.*` unchanged.
- State event = current value of one thing in a room (`state_key` selects which). Message event = something that happened. Never encode history in state.
- Decoders live in `src/events/fabrium-*.ts`, one per domain, same shape as `ZW` `src/events/approval.ts`: pure function `MatrixEvent → typed view | null`, unknown fields ignored, vitest per decoder.
- Trust: the UI trusts a `dev.fabrium.*` event only if its sender is the Fabrium service user or (for human actions) a non-agent member. Same check pattern as `ZW` `elicitation_resolved`. Power levels in each room restrict who may send each `dev.fabrium.*` state type (`events` map).
- Size: Matrix events max 64 KB. Bodies over 48 KB go to the media repo; the event holds `mxc` + `sha256`.
- Sealed rooms: no `dev.fabrium.*` events that copy content out of the room; no previews; search box shows "not searchable".
- Service API: base URL from new optional `/config.json` field `fabrium_api_url`; auth = Matrix OpenID token (`POST /_matrix/client/v3/user/{userId}/openid/request_token`), the service validates it against the homeserver. One fetch helper `src/client/fabrium-api.ts`. Add the field and helper only when the first `api` backlog item is built.
- Room-scoped `dev.fabrium.*` events are sent by the Fabrium service (an appservice, like the Zooid daemon), never invented by the UI, except human actions: decision, approval response, suggestion accept/reject, agent command, canvas edit.

## 7. Work packages (in order; each ends green: `build`, `test`, `typecheck`, `check-design`)

| WP  | Scope                                                                                                                                                                          | Sections          | Done when                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W0  | Import `ZW/packages/web` into `packages/web`; React 19 + Vite upgrade; fix tests; `CLI` resolve in-repo dist + delete npm fetch path; `README` in package; `THIRD_PARTY_NOTICES.md` (§8)               | §1 D1 D10 D16, §2 | `zooid dev` serves `packages/web/dist`; all `ZW` tests + e2e pass unchanged                                                                                                       |
| W1  | Design foundation                                                                                                                                                                | §3                | §3.7                                                                                                                                                                              |
| W2  | Shell: rail, resizable sidebar, top bar, header, right pane, mobile, shortcuts                                                                                                 | §4.1, §4.2        | Navigate rooms, open/close/resize panes; layout at 375px and 1440px; state survives reload                                                                                        |
| W3  | View model + timeline + message row + reactions + actions                                                                                                                      | §4.3, §4.4, §5    | `from-matrix.test.ts` green; 5k-event room scrolls without jank; load older keeps anchor; edit/delete/react work; `?event=` highlight works; `e2e/timeline-history.spec.ts` green |
| W4  | Thread pane + TipTap composer + typing                                                                                                                                         | §4.5, §4.6        | Thread opens in right pane from summary row and `?thread=`; mentions produce `m.mentions`; slash commands + stop still work; `e2e/media-attach.spec.ts` green                     |
| W5  | Agent UI                                                                                                                                                                       | §4.8, §6.1, §6.2  | Turn block groups tool calls; approval round-trip `e2e/approval-roundtrip.spec.ts` green; elicitation flow green; activity bar shows running turn and stops it                    |
| W6  | Search, ⌘K, inbox, members, profile popover, settings, dialogs, auth screens                                                                                                   | §4.7, §4.9, §4.10 | Inbox lists open approvals across rooms; search returns messages (or shows "not supported by server" state)                                                                       |
| W7  | Delete unused `ZW` components; Storybook stories for every new presentational component (both themes); axe sweep in Playwright for both themes | —                 | No orphan files (`knip` or grep); axe: 0 serious violations                                                                                                                       |

Per-WP rules:

- Copy a `BZ` file → first commit = verbatim copy with header comment (§8), second commit = adaptation. Reviewers diff the second.
- Delete the `ZW` component a copied component replaces in the same WP.
- Keep or port the existing `ZW` test for each replaced component; add a Storybook story for each new presentational component.
- No new dependency outside this list without a note in the PR: `virtua`, `@tiptap/*`, `tiptap-markdown`, `@fontsource-variable/manrope`, `@fontsource-variable/inter`, `highlight.js`, `motion` (only if a copied component needs it; prefer CSS `modal-motion`).
- Run `package-vetting` before each `pnpm add`.

## 8. Licensing

- `BZ` is Apache-2.0 (© 2026 Block, Inc.). This repo is MIT. Apache-2.0 code may be included with notice.
- Add `packages/web/THIRD_PARTY_NOTICES.md`: full Apache-2.0 text once, attribution "Buzz, Copyright 2026 Block, Inc.", statement "Files derived from Buzz were modified", list of derived files.
- Header on every file copied from `BZ`: `// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/<path>. Modified.`
- Files copied from `HV`: no header (in-house code, naming rule applies). Exception: if `git -C /Users/tw/dev/jan3/haven-chat-ui log --follow <file>` shows the file came from Hugging Face chat-ui, add it to `THIRD_PARTY_NOTICES.md` under "Hugging Face chat-ui, Copyright 2018- The Hugging Face team, Apache-2.0" and add the header `// Derived from Hugging Face chat-ui (Apache-2.0). Modified.`
- Do not copy `BZ desktop/public/pow/**` (MIT, Emerge Tools).

## 9. Backlog (build when the backend sends the events; mechanism per §6.4)

| Phase (`FB` §19) | UI | Matrix mechanism | Reuse |
| --- | --- | --- | --- |
| P2 | Channel canvas (one per channel), version history | `dev.fabrium.canvas` state + `.edit` events | `BZ features/channels/ui/ChannelCanvas.tsx`, `CanvasHistoryPanel.tsx` (R, pattern); markdown source + live preview |
| P2 | Forum channels | thread-root rooms, `dev.fabrium.channel` kind | `BZ features/forum/ui/*` (R, pattern) |
| P3 | Agent directory grouped by persona; creation wizard; directive editor + history; budgets (sats, `--money`); Haven account linking; persona drift banner | service API | `BZ AgentIdentityCard`; `HV` Callout/Card |
| P3 | Notes review feed (states unreviewed, accepted, forgotten, expired; provenance) | service API | `BZ features/pulse/ui/*` |
| P3 | Per-room agent settings (`respond_policy`, instructions) | `dev.fabrium.agent_settings` state | — |
| P3 | Manager commands `/agent cancel`, `rotate`, `pause`, `resume`, `status`, `forget` (`FB` §10.4) | `dev.fabrium.agent_command` | `ZW lib/slash-commands.ts` |
| P4 | Tasks (status, assignee, children) | `dev.fabrium.task` state | — |
| P4 | Canvas suggestions accept/reject per section | `dev.fabrium.canvas.suggestion` + `m.reference` | — |
| P4 | `/decide` + decision reaction | `dev.fabrium.decision` | — |
| P4 | Catalog (personas, templates, styles) with tool-policy matrix ✓ ✋ ✕ | service API | — |
| P5 | Workflow runs, approval gates with pinned canvas version and timeout | `dev.zooid.approval_*` + extra fields | `BZ WorkflowApprovalCard` |
| P6 | Sidebar tree project → release → task room (`FB` §16.3), archived channels | nested `m.space.child`, `dev.fabrium.release`, tombstone | `BZ SidebarDnd.tsx` (A) for tree |
| P6 | GitHub/CI events, link-GitHub prompt before merge approval | `dev.fabrium.github.*`, `dev.fabrium.ci.*` | — |
| P6 | Preview tab (separate origin) | `dev.fabrium.preview` | `HV` artifacts panel (pattern only, iframe sandbox) |
| P6 | Repo doc editor | service API | — |
| P6 | Huddles | MatrixRTC + LiveKit | — |
| P7 | Sealed channels (no server search, no previews, no agents) | `m.room.encryption` | `ZW` already handles E2EE flag in `RoomSummary.isEncrypted` |
| P7 | Audit log view + export, usage reconciliation | service API | — |
| P8 | Attestation badge per agent (`--trust-enclave`; states attested, log-only, unattested), break-glass requests | service API | `FB` design.html "TEE" corner tag |

## 10. Open decisions (default applies until settled)

| #   | Question                                                  | Default                                                                                                  |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| O2  | Logo | Placeholder text wordmark `Fabrium` in `font-heading` semibold, only in `components/brand/logo.tsx`; swapped later |
| O3  | Fabrium semantic tokens (§3.3) and any color Haven lacks | Map to Haven primitives only; no invented hex; a new color needs design sign-off |
| O5  | Matrix message search / notifications API on Tuwunel      | _verify_ in W6; show "not supported" state if absent                                                     |
| O6  | Where `persona`/`project` come from in `zooid.yaml`       | New optional agent keys `persona`, `project`; fallback agent `name` + workforce space name               |
| O7  | Fabrium design §5–§7 (own event log, WebSocket, per-workspace `seq`) vs Matrix (D17) | Matrix. Needs a decision record in the fabrium repo (`docs/decisions/NNNN-matrix-transport.md`) that replaces §5–§7, reviewed by the design owner |
| O8  | Workspace-wide hash-chained audit log (`FB` §15.2) | Fabrium service joins every room as appservice, chains events per workspace, serves export via API |
