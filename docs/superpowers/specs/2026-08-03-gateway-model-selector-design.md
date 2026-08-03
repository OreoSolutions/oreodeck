# Gateway model selector design

## Goal

Make gateway creation easy to scan and let users map Claude model families from
the models a compatible gateway actually advertises. The selector is an
optional convenience, never a requirement for creating a gateway profile.

## Scope

This changes the **Add gateway profile** sheet only. Existing profiles keep
their current model-mapping editor and no gateway configuration is rewritten.

## Interaction design

The sheet uses a wider, row-based form:

1. Profile name, Gateway URL, and API key are the connection inputs.
2. A `Check endpoint` action makes one explicit, transient request to the
   gateway's `/models` endpoint.
3. While checking, the action is disabled and communicates progress. A
   successful non-empty result shows a concise success state and reveals
   **Model mapping**.
4. Each mapping is one scanable row: `Claude Fable/Opus/Sonnet/Haiku`, an
   arrow, a provider-model-ID text field, and a `Select model` menu.
5. Choosing an item fills that row's text field. A user can still edit or
   clear the ID manually. Blank values retain Claude Code's default mapping.
6. If the endpoint cannot be checked, rejects credentials, returns an invalid
   response, or advertises zero models, no model-mapping rows are shown. The
   connection result stays actionable and the profile can still be added with
   default mappings.

The modal keeps native macOS controls and uses terracotta for the primary
action/state, matching OreoDeck's existing charcoal-and-terracotta identity.

## Data and security boundary

Add a dedicated transient core operation that accepts the draft URL and token
without writing either to configuration or Keychain. It returns only a
display-safe result: state, sanitized endpoint, message, and a de-duplicated
list of non-empty provider model IDs. It never returns the token, response
body, headers, or raw transport error.

The Swift model holds the discovered IDs only while the add sheet is open.
Changing URL or token invalidates them. Saving the profile continues to use the
existing Keychain-only credential path.

## Error handling and accessibility

The action has idle, checking, connected-with-models, empty-result,
unauthorized, and unreachable states. Error copy must never echo credentials
or raw network details. The model menu has an accessible label that identifies
which Claude family it fills; the typed field remains available for keyboard
users whenever mappings are visible.

## Verification

- Rust tests cover deduplication, empty-model handling, and safe failures for
  the draft endpoint operation.
- Swift tests cover request forwarding, state invalidation, and no secret
  retention.
- View tests cover hidden mappings before/after unavailable checks, revealed
  rows after a successful result, and selecting a model.
- Build the release app and run the targeted SwiftUI visual render check.
