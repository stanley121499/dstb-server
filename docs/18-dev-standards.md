# Dev standards (authoritative)

## Purpose

Define coding and documentation standards so implementations are consistent across agents and phases.

## Language and type safety

- Backend is recommended as **Node.js + TypeScript**.
- TypeScript must be **strict**.
- Do not use:
  - `any`
  - non-null assertions (`!`)
  - unsafe casts like `as unknown as T`

## Validation and error handling

- All external inputs must be validated:
  - API request bodies
  - environment variables
  - database rows (when deserializing JSONB)
- Validation errors must use the standard error response shape (see `15-api-contracts.md`).

## Strings

- Use **double quotes** for strings.
- Avoid `+` string concatenation:
  - Prefer template strings or `.join()`.

## Comments and documentation

- All exported functions should have **JSDoc** that explains:
  - Inputs
  - Outputs
  - Edge cases
  - Error behavior
- Complex logic (session mapping, DST, intrabar ordering) must have inline comments.

## Strategy engine invariants

- Timezone and session calculations must use `America/New_York` and be DST-aware.
- No lookahead bias:
  - Opening range must complete before using OR levels.
  - ATR must be computed only from historical data.

## Testing expectations (when implementation starts)

- Unit tests for:
  - ATR calculation (including Wilder smoothing)
  - Session boundary computations across DST transitions
  - OR calculation for a known day
  - Execution model (fees/slippage) and trigger ordering

## Logging

- Use structured logging with stable event codes.
- Store run/bot events to Supabase as defined in `17-supabase-schema-and-migrations.md`.

## Windows dev environment notes

- Support Windows 11 development with PowerShell.
- Avoid platform-specific shell scripts where possible.



