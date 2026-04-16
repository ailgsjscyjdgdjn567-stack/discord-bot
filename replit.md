# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies. Includes a fully-featured Discord bot built with discord.js.

## Discord Bot Features

- **Приветствие** — автоматически приветствует новых участников в системном канале
- **Slash-команды** — /ping, /help, /info, /ask, /ban, /kick, /mute, /unmute, /purge, /role
- **Модерация** — бан, кик, мут (тайм-аут), удаление сообщений
- **Роли** — выдача и снятие ролей
- **ИИ** — /ask использует OpenAI GPT для ответов на вопросы

Bot code: `artifacts/api-server/src/bot/index.ts`

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
