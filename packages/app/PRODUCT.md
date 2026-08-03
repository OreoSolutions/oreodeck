# Product

<!-- impeccable:product-schema 1 -->

## Platform

macOS native SwiftUI application (macOS 15 or later).

## Users

Developers who use Claude Code across more than one account, API key, or
Anthropic-compatible gateway, and need to keep those identities isolated while
choosing the right one for each terminal session.

## Product Purpose

OreoDeck makes multi-profile Claude Code work predictable from a native macOS
dashboard and the `oreodeck` / `ord` CLI. Users can create profiles, choose an
active identity, launch a session, monitor usage, configure failover, and
manage supporting CLI setup without exposing credentials.

## Positioning

OreoDeck is a Claude Code companion, not another AI client. It coordinates
isolated Claude Code configurations, profile-local credentials, and gateway
model aliases while preserving Claude Code as the coding interface.

## Operating Context

The app and CLI share OreoDeck configuration. A user commonly switches from
the dashboard to a terminal, launches Claude Code through a chosen profile,
and returns to inspect usage or select a fallback profile. Gateway profiles
use an Anthropic-compatible base URL and may map Claude model families to the
provider's actual model IDs.

## Capabilities and Constraints

- Profile kinds are Subscription, API key, and Anthropic-compatible gateway.
- Secrets remain in macOS Keychain; a configuration file never stores API
  keys.
- Gateway model IDs are optional: empty mappings keep Claude Code defaults.
- The dashboard has Profiles, Usage, Failover, CLI & Tools, and Settings
  sections plus a menu-bar surface.
- Existing brand direction is Charcoal + terracotta with the Layered Bloom
  mark. The dashboard must remain recognisably native to macOS.

## Brand Commitments

OreoDeck is a clear companion to Claude Code. Its identity is warm, precise,
and calm rather than loud or decorative. The Layered Bloom mark expresses
multiple profiles.

## Evidence on Hand

- Product overview and workflows: `README.md`.
- Native dashboard source: `Sources/CcmUI/`.
- Existing brand assets: `../../assets/brand/`.
- No customer testimonials, benchmark claims, or usage analytics are supplied;
  the interface must not invent them.

## Product Principles

1. Make the active identity and its next action unambiguous.
2. Keep profile-specific configuration and credentials visibly separate.
3. Prefer quick scanning and clear recovery over dense configuration screens.
4. Preserve Claude Code's workflow instead of competing with it.
5. Make gateway compatibility inspectable before a coding session begins.
