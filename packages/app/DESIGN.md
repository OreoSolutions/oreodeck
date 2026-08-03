# Calm Control Center

The OreoDeck dashboard is a native macOS operating surface for managing Claude
Code identities. It uses system typography and familiar macOS controls; the
brand appears through hierarchy and state, never by replacing native task
affordances.

## Color roles

- Charcoal anchors the sidebar and product identity.
- Terracotta is reserved for the active navigation item and primary actions.
- Warm cream/sand support the companion identity without becoming the default
  content background.
- Green, amber, and red are semantic gateway and system states. Every state
  also has a text label and accessibility description.

## Layout grammar

Each dashboard tab follows the same order: a concise page header, the current
decision or status, its working surface, then task-specific commands or
recovery. Tables remain dense scanning tools; selected-profile details,
configuration, and explanations use named section cards.

The sidebar has three regions: OreoDeck identity, navigation, and compact
system status. It always preserves full-row keyboard targets and communicates
selection through text, colour, and accessibility traits.

## Gateway UI

Gateway connection checks are one-off `/models` requests. The dashboard shows
only display-safe endpoint metadata, model counts, and actionable states; API
keys, raw response bodies, and raw transport errors never appear in SwiftUI.
