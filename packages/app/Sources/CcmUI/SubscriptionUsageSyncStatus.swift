import CcmKit
import SwiftUI

/// A small, reusable status boundary for the experimental OAuth usage fetch.
/// It deliberately receives only the Rust view record: credentials are never
/// made available to SwiftUI, copy/paste, logs, or accessibility text.
struct SubscriptionUsageSyncStatus: View {
    let sync: SubscriptionUsageSyncView?
    let enabled: Bool
    let nowMs: Int64
    let refresh: () -> Void
    let loginAgain: () -> Void

    private var state: String { sync?.state ?? (enabled ? "cannot-verify" : "disabled") }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: icon)
                    .foregroundStyle(color)
                    .frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 7) {
                        Text("Live subscription usage")
                            .font(.subheadline.weight(.semibold))
                        if enabled {
                            StatusPill(text: state == "connected" ? "Live" : stateLabel, color: color)
                        } else {
                            StatusPill(text: "Off", color: .secondary)
                        }
                    }
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let fetchedAt = sync?.fetchedAtMs {
                        Text("Last checked \(formatAge(timestampMs: fetchedAt, nowMs: nowMs))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }

            if enabled {
                HStack(spacing: 8) {
                    if state == "needs-sign-in" {
                        Button("Login again", action: loginAgain)
                            .buttonStyle(.bordered)
                    }
                    Button(state == "checking" ? "Checking…" : "Refresh usage", action: refresh)
                        .buttonStyle(.bordered)
                        .disabled(state == "checking" || state == "rate-limited")
                }
                .controlSize(.small)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(state == "connected" ? 0.07 : 0.10), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
    }

    private var message: String {
        guard enabled else {
            return "Off. Enable this experimental setting to check the selected profile directly."
        }
        return sync?.message ?? "No live result yet. Refresh this profile to check its subscription usage."
    }

    private var stateLabel: String {
        switch state {
        case "checking": "Checking"
        case "needs-sign-in": "Sign in"
        case "rate-limited": "Rate limited"
        default: "Unavailable"
        }
    }

    private var color: Color {
        switch state {
        case "connected": .green
        case "checking": OreoTheme.cyan
        case "needs-sign-in", "rate-limited": .orange
        default: .secondary
        }
    }

    private var icon: String {
        switch state {
        case "connected": "checkmark.circle.fill"
        case "checking": "arrow.triangle.2.circlepath"
        case "needs-sign-in": "person.crop.circle.badge.exclamationmark"
        case "rate-limited": "clock.badge.exclamationmark"
        default: "questionmark.circle"
        }
    }
}
