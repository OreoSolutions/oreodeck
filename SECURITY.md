# Security policy

English | [Tiếng Việt](SECURITY.vi.md) | [简体中文](SECURITY.zh-CN.md)

## Supported versions

Security fixes are provided for the latest released version of OreoDeck.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| Earlier or unreleased builds | No |

## Reporting a vulnerability

Please do not disclose vulnerabilities, credentials, account information, or
exploit details in a public issue.

Report vulnerabilities through GitHub's private vulnerability reporting or
private security advisory feature for `OreoSolutions/oreodeck`. Include:

- The affected OreoDeck version and macOS version.
- Reproduction steps or a minimal proof of concept.
- The expected and observed security impact.
- Whether profile data, API keys, OAuth state, shell integration, symlinks, or
  terminal command execution are involved.

The maintainers will acknowledge a complete report when reviewed, investigate
it privately, and coordinate disclosure with the reporter when practical. No
specific response or remediation deadline is guaranteed.

## Scope

High-priority areas include credential exposure, profile-isolation bypasses,
path traversal, unsafe symlink handling, terminal command injection, insecure
Keychain access, and destructive uninstall behavior outside OreoDeck-managed
paths.

Claude Code, terminal applications, macOS, and other third-party dependencies
have their own security policies. Vulnerabilities exclusively affecting those
projects should also be reported upstream.
