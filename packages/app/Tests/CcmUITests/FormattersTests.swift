import CcmKit
import Testing

@testable import CcmUI

@Test func costIsADashForSubscriptionAndDollarsForApiKey() {
    // Spec §3: a subscription has no per-token bill, so showing "$0.00" would
    // be a lie. api-key profiles show real dollars.
    #expect(formatCost(kind: "subscription", costUsd: 0.09195) == "—")
    #expect(formatCost(kind: "api-key", costUsd: 0.09195) == "$0.09")
    #expect(formatCost(kind: "api-key", costUsd: 0) == "$0.00")
    #expect(formatCost(kind: "api-key", costUsd: 12.5) == "$12.50")
}

@Test func tokensAreGroupedDeterministically() {
    #expect(formatTokens(24700) == "24,700")
    #expect(formatTokens(0) == "0")
    #expect(formatTokens(1234567) == "1,234,567")
}

@Test func countdownIsADashWhenThereIsNoResetAndCountsDownOtherwise() {
    // Numbers come from packages/contract-fixtures/expected-usage.json:
    // nowMs 1784203200000, resetAtMs 1784214005000 → 10805000 ms → 3h 0m.
    #expect(formatCountdown(resetAtMs: nil, nowMs: 1_784_203_200_000) == "—")
    #expect(formatCountdown(resetAtMs: 1_784_214_005_000, nowMs: 1_784_203_200_000) == "3h 0m")
    #expect(formatCountdown(resetAtMs: 1_784_203_200_000 + 45 * 60_000, nowMs: 1_784_203_200_000) == "45m")
    #expect(formatCountdown(resetAtMs: 1_784_203_200_000 + 49 * 60 * 60_000, nowMs: 1_784_203_200_000) == "2d 1h")
    #expect(formatCountdown(resetAtMs: 1_784_203_200_000, nowMs: 1_784_203_200_000) == "now")
    #expect(formatCountdown(resetAtMs: 1_784_203_100_000, nowMs: 1_784_203_200_000) == "now")
}

@Test func everyCcmErrorRendersAsHumanCopyWithNoMachineSentinel() {
    // The old webview app showed users the raw string "CONFIG_CORRUPT". This
    // test is the guard: every variant must produce a sentence, and the copy
    // must never contain a machine token.
    let all: [CcmError] = [
        .ConfigCorrupt,
        .InvalidName(name: "../evil", message: "Invalid profile name: \"../evil\". Use letters, digits, - and _ (max 64 chars)."),
        .NotFound(name: "ghost"),
        .AlreadyExists(name: "work"),
        .Io(message: "A file operation failed. Check that ~/.ccm is readable and writable."),
        .Keychain(message: "Failed to save API key for profile \"bot\" to macOS Keychain."),
    ]
    for error in all {
        let copy = message(for: error)
        #expect(!copy.isEmpty)
        #expect(!copy.contains("CONFIG_CORRUPT"))
        #expect(copy.first!.isUppercase)
        #expect(copy.hasSuffix("."))
    }
    #expect(message(for: .NotFound(name: "ghost")).contains("ghost"))
}
