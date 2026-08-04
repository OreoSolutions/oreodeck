import CcmKit
import SwiftUI

/// OAuth-first subscription usage status. The raw Claude credential never
/// leaves the Rust core; this view only renders the redacted state.
struct SubscriptionUsageSyncStatus: View {
    let display: SubscriptionUsageDisplay
    let sync: SubscriptionUsageSyncView?
    let cachedAtMs: Int64?
    let nowMs: Int64
    let refresh: () -> Void
    let loginAgain: () -> Void

    init(
        row: ProfileRow,
        sync: SubscriptionUsageSyncView?,
        nowMs: Int64,
        refresh: @escaping () -> Void,
        loginAgain: @escaping () -> Void
    ) {
        self.display = SubscriptionUsageDisplay(row: row, sync: sync)
        self.sync = sync
        self.cachedAtMs = row.planUsageFetchedAtMs
        self.nowMs = nowMs
        self.refresh = refresh
        self.loginAgain = loginAgain
    }

    private var state: String { sync?.state ?? "idle" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: icon)
                    .foregroundStyle(tint)
                    .frame(width: 18)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text("Live Claude usage").font(.subheadline.weight(.semibold))
                        StatusPill(text: label, color: tint)
                    }
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Button(refreshTitle, action: refresh)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(state == "checking")
            }
            if !display.limits.isEmpty {
                VStack(spacing: 12) {
                    ForEach(display.limits, id: \.id) { limit in
                        SubscriptionUsageLimit(
                            title: limit.label,
                            percent: limit.percent,
                            resetAtMs: limit.resetAtMs,
                            nowMs: nowMs
                        )
                    }
                }
                if let spend = sync?.extraUsageSpendUsd, let limit = sync?.extraUsageLimitUsd {
                    Text(String(format: "$%.2f of $%.2f extra usage", spend, limit))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            if needsLogin {
                Button("Login again", action: loginAgain)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var needsLogin: Bool {
        ["needs-sign-in", "oauth-mcp-only", "oauth-missing-scope"].contains(state)
    }

    private var refreshTitle: String {
        switch state {
        case "checking": "Refreshing…"
        case "keychain-access-needed": "Grant access & refresh"
        default: "Refresh usage"
        }
    }

    private var label: String {
        switch state {
        case "connected": "Live"
        case "checking": "Checking"
        case "keychain-access-needed": "Keychain access"
        case "oauth-mcp-only", "oauth-missing-scope": "Re-authenticate"
        case "needs-sign-in": "Sign in"
        case "rate-limited": "Waiting"
        default: cachedAtMs == nil ? "Not connected" : "Last snapshot"
        }
    }

    private var message: String {
        if let message = sync?.message { return message }
        if let cachedAtMs {
            return "Last Claude snapshot \(formatAge(timestampMs: cachedAtMs, nowMs: nowMs)). Refresh to read live OAuth usage."
        }
        return "Refresh usage to connect this profile through Claude OAuth."
    }

    private var tint: Color {
        switch state {
        case "connected": .green
        case "checking": OreoTheme.cyan
        case "needs-sign-in", "oauth-mcp-only", "oauth-missing-scope", "keychain-access-needed": .orange
        case "rate-limited": OreoTheme.terracotta
        default: .secondary
        }
    }

    private var icon: String {
        switch state {
        case "connected": "checkmark.circle.fill"
        case "checking": "arrow.triangle.2.circlepath"
        case "needs-sign-in", "oauth-mcp-only", "oauth-missing-scope": "person.crop.circle.badge.exclamationmark"
        case "keychain-access-needed": "key.fill"
        case "rate-limited": "clock.badge.exclamationmark"
        default: "chart.bar"
        }
    }
}

private struct SubscriptionUsageLimit: View {
    let title: String
    let percent: Double?
    let resetAtMs: Int64?
    let nowMs: Int64

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Text(percent.map { "\(Int($0.rounded()))% used" } ?? "Not available")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            ProgressView(value: min(max(percent ?? 0, 0), 100), total: 100)
                .tint((percent ?? 0) >= 90 ? .red : (percent ?? 0) >= 70 ? .orange : .accentColor)
            Text("Resets in \(formatCountdown(resetAtMs: resetAtMs, nowMs: nowMs))")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
