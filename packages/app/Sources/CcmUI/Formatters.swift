import CcmKit
import Foundation

/// A subscription profile is billed by plan, not by token — showing a dollar
/// figure for it would invent a number the user is not being charged. "—" is
/// the honest answer (spec §3).
public func formatCost(kind: String, costUsd: Double) -> String {
    guard kind != "subscription" else { return "—" }
    return String(format: "$%.2f", costUsd)
}

/// Pinned to en_US so grouping is deterministic in tests and does not depend on
/// the machine's locale.
public func formatTokens(_ n: Int64) -> String {
    n.formatted(.number.grouping(.automatic).locale(Locale(identifier: "en_US")))
}

/// nil resetAtMs ⇒ no billable entry in the 5h window ⇒ nothing to count down
/// to ⇒ "—" (spec §3). Already elapsed ⇒ "now".
public func formatCountdown(resetAtMs: Int64?, nowMs: Int64) -> String {
    guard let resetAtMs else { return "—" }
    let remainingMs = resetAtMs - nowMs
    guard remainingMs > 0 else { return "now" }
    let totalMinutes = Int(remainingMs / 60_000)
    let hours = totalMinutes / 60
    let minutes = totalMinutes % 60
    return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
}

/// Turns a typed error into copy a human can read. This is a `switch` on the
/// enum — the ONLY sanctioned way to branch on a CcmError. Never compare the
/// error's text; the Tauri version did (a `"CONFIG_CORRUPT"` sentinel) and the
/// sentinel ended up on the user's screen.
public func message(for error: CcmError) -> String {
    switch error {
    case .ConfigCorrupt:
        return "The ccm config file is not valid JSON and could not be read."
    case .InvalidName(_, let message):
        // store.rs already produced the full sentence (including the charset
        // hint) — don't re-write it here and let the two drift.
        return message
    case .NotFound(let name):
        return "Profile \"\(name)\" no longer exists. It may have been removed from another window or by the ccm CLI."
    case .AlreadyExists(let name):
        return "A profile named \"\(name)\" already exists. Pick another name."
    case .Io(let message):
        return message
    case .Keychain(let message):
        return message
    }
}
