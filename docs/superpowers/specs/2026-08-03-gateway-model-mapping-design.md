# Gateway Model Mapping Design

## Goal

Let each Anthropic-compatible gateway profile map Claude Code's four model
families — Opus, Sonnet, Haiku, and Fable — to provider-specific model IDs.
An empty mapping preserves Claude Code's normal Anthropic default for that
family.

## Configuration contract

Gateway profiles gain an optional `modelMappings` object in `config.json`:

```json
{
  "name": "team-gateway",
  "kind": "gateway",
  "gatewayBaseUrl": "https://gateway.example.com/anthropic",
  "modelMappings": {
    "opus": "provider/large-model",
    "sonnet": "provider/general-model",
    "haiku": "provider/fast-model",
    "fable": "provider/reasoning-model"
  }
}
```

Each key is optional. Values are trimmed, non-empty provider model IDs and
must not contain control characters. `modelMappings` is valid only on a
gateway profile; no token or other credential is stored with it. Unknown
future fields remain lossless through TypeScript and Rust config writes.

## Runtime behavior

When OreoDeck launches a gateway profile, it already sets the endpoint and
gateway token. It will additionally set only non-empty mappings:

| Mapping | Environment variable |
| --- | --- |
| `opus` | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |
| `fable` | `ANTHROPIC_DEFAULT_FABLE_MODEL` |

The launcher clears inherited values for all four variables before applying
the selected profile. This prevents a shell-level mapping from leaking into a
different profile. Empty mappings leave the variables unset, so Claude Code
keeps its own model-family defaults.

## Interfaces

The macOS Add Gateway sheet shows four optional model-ID text fields. A
gateway-only "Edit model mapping…" action lets users update an existing
profile without recreating it. The CLI exposes the same values on creation
through `--opus-model`, `--sonnet-model`, `--haiku-model`, and
`--fable-model`; the values are accepted only with `--gateway`.

The native Rust API includes a typed gateway-model update operation, and the
TypeScript profile store has a matching operation. List and status views keep
showing the profile kind; model IDs are not rendered in compact tables.

## Error handling and verification

Invalid model IDs fail before a config write, with a message that does not
include credentials. A failed mapping update leaves the prior profile intact.
Tests cover TypeScript/Rust config validation and launch-environment isolation,
CLI option validation, Swift view-model forwarding, and the shared contract
fixture. Full Bun, Rust, SwiftUI, contract, typecheck, and bundle verification
run before commit.
