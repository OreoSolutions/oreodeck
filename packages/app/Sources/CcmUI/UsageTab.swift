import CcmKit
import SwiftUI

/// The five token layers, stacked in one bar, in the order they appear on the
/// bill. Widths are proportional to the row's own total — this is a breakdown
/// of that profile's 5h window, not a comparison against a quota (Claude does
/// not publish one).
public struct UsageBar: View {
    private let row: ProfileRow

    public init(row: ProfileRow) {
        self.row = row
    }

    private var layers: [(label: String, value: Int64, color: Color)] {
        [
            ("Input", row.inputTokens, .blue),
            ("Cache write 5m", row.cacheWrite5mTokens, .teal),
            ("Cache write 1h", row.cacheWrite1hTokens, .purple),
            ("Cache read", row.cacheReadTokens, .green),
            ("Output", row.outputTokens, .orange),
        ]
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GeometryReader { geo in
                HStack(spacing: 0) {
                    // `row.totalTokens > 0` guards every division below — a
                    // fresh/zero-usage profile falls through to the single
                    // grey placeholder instead of dividing by zero (spec:
                    // "zero-usage profile must render sanely").
                    if row.totalTokens > 0 {
                        ForEach(layers, id: \.label) { layer in
                            if layer.value > 0 {
                                Rectangle()
                                    .fill(layer.color)
                                    .frame(
                                        width: geo.size.width * CGFloat(layer.value)
                                            / CGFloat(row.totalTokens)
                                    )
                                    .help("\(layer.label): \(formatTokens(layer.value))")
                            }
                        }
                    } else {
                        Rectangle().fill(Color.secondary.opacity(0.15))
                    }
                }
            }
            .frame(height: 10)
            .clipShape(RoundedRectangle(cornerRadius: 3))

            HStack(spacing: 10) {
                ForEach(layers, id: \.label) { layer in
                    HStack(spacing: 3) {
                        Circle().fill(layer.color).frame(width: 6, height: 6)
                        Text("\(layer.label) \(formatTokens(layer.value))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

private struct PlanUsageBar: View {
    let label: String
    let percent: Double?
    let resetAtMs: Int64?
    let nowMs: Int64

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label).font(.subheadline.weight(.semibold))
                Spacer()
                if let percent {
                    Text("\(Int(percent.rounded()))% used")
                        .monospacedDigit()
                } else {
                    Text("Not available").foregroundStyle(.secondary)
                }
                Text("resets in \(formatCountdown(resetAtMs: resetAtMs, nowMs: nowMs))")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: min(max(percent ?? 0, 0), 100), total: 100)
                .tint((percent ?? 0) >= 90 ? .red : (percent ?? 0) >= 70 ? .orange : .accentColor)
        }
    }
}

public struct UsageTab: View {
    @ObservedObject private var model: AppModel

    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageHeader(
                    eyebrow: "Claude account limits",
                    title: "Usage overview",
                    subtitle: "Account usage and reset times reported by Claude, separated by profile.",
                    systemImage: "chart.bar.xaxis"
                )
                if let active = model.rows.first(where: \.active) {
                    OreoSectionCard("Current profile", subtitle: "The identity new Claude Code sessions use") {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(active.name).font(.title3.weight(.semibold))
                                Text(active.kind == "subscription" ? usageSourceSubtitle(for: active) : "Local request telemetry")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            StatusPill(
                                text: planFiveHourPercent(for: active).map { "\(Int($0.rounded()))% used" } ?? "Ready",
                                color: planFiveHourPercent(for: active) ?? 0 >= 90 ? .red : OreoTheme.terracotta
                            )
                        }
                    }
                }
                if let loadError = model.loadError {
                    // Must come before the `rows.isEmpty` check below: a
                    // config-read failure also leaves `rows` empty (see
                    // `AppModel.load()`), and without this branch first the
                    // tab would fall through to "No profiles yet" — telling
                    // the user to add a profile that may already exist and
                    // simply failed to read (Task 4 review, Important
                    // finding).
                    LoadErrorView(model: model, error: loadError)
                } else if model.rows.isEmpty {
                    OreoEmptyState(
                        title: "No profiles yet",
                        message: "Add a profile from Profiles, then launch Claude to start tracking its five-hour window.",
                        systemImage: "chart.bar",
                    )
                } else {
                    ForEach(model.rows) { row in
                        OreoSectionCard(row.name, subtitle: row.active ? "Active profile" : "Profile usage") {
                            HStack {
                                Text(row.name).font(.headline)
                                if row.active {
                                    Text("active")
                                        .font(.caption)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 1)
                                        .background(Color.accentColor.opacity(0.2))
                                        .clipShape(Capsule())
                                }
                                Spacer()
                                if row.kind == "api-key" || row.kind == "gateway" {
                                    Text("\(formatTokens(row.totalTokens)) local tokens")
                                        .monospacedDigit()
                                    Text(formatCost(kind: row.kind, costUsd: row.costUsd))
                                        .monospacedDigit()
                                        .foregroundStyle(.secondary)
                                } else if let fetchedAt = row.planUsageFetchedAtMs {
                                    Text("updated \(formatAge(timestampMs: fetchedAt, nowMs: model.nowMs))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if row.kind == "subscription" {
                                SubscriptionUsageSyncStatus(
                                    sync: model.subscriptionUsageSyncs[row.name],
                                    enabled: model.directSubscriptionUsageSyncEnabled,
                                    nowMs: model.nowMs,
                                    refresh: { Task { await model.refreshSubscriptionUsage(name: row.name, force: true) } },
                                    loginAgain: { Task { await model.loginAgain(name: row.name) } }
                                )
                                PlanUsageBar(
                                    label: "5-hour session",
                                    percent: planFiveHourPercent(for: row),
                                    resetAtMs: planFiveHourResetAtMs(for: row),
                                    nowMs: model.nowMs
                                )
                                PlanUsageBar(
                                    label: "Weekly",
                                    percent: planWeeklyPercent(for: row),
                                    resetAtMs: planWeeklyResetAtMs(for: row),
                                    nowMs: model.nowMs
                                )
                                if let extraUsage = liveSync(for: row),
                                   let spend = extraUsage.extraUsageSpendUsd,
                                   let limit = extraUsage.extraUsageLimitUsd {
                                    Text(extraUsageText(spend: spend, limit: limit))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                                if model.subscriptionUsageSyncs[row.name]?.state != "connected", row.planUsageFetchedAtMs == nil {
                                    Text("No Claude usage cache yet. Open this profile in Claude and run /usage.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            } else {
                                UsageBar(row: row)
                            }
                        }
                    }
                }
                CommandSuggestions(model: model, commands: [
                    CLICommandSuggestion("ord status", "Show the same usage summary in Terminal."),
                    CLICommandSuggestion("ord run -P <profile> -p \"hello\"", "Run a headless request with explicit profile selection."),
                ])
            }
            .padding(4)
        }
        .onAppear { Task { await model.surfaceAppeared(.usageTab) } }
        .onDisappear { model.surfaceDisappeared(.usageTab) }
        .onReceive(timer) { _ in Task { await model.tick() } }
    }

    private func liveSync(for row: ProfileRow) -> SubscriptionUsageSyncView? {
        let sync = model.subscriptionUsageSyncs[row.name]
        return sync?.state == "connected" ? sync : nil
    }

    private func planFiveHourPercent(for row: ProfileRow) -> Double? {
        liveSync(for: row)?.fiveHourPercent ?? row.planFiveHourPercent
    }

    private func planFiveHourResetAtMs(for row: ProfileRow) -> Int64? {
        liveSync(for: row)?.fiveHourResetAtMs ?? row.planFiveHourResetAtMs
    }

    private func planWeeklyPercent(for row: ProfileRow) -> Double? {
        liveSync(for: row)?.weeklyPercent ?? row.planWeeklyPercent
    }

    private func planWeeklyResetAtMs(for row: ProfileRow) -> Int64? {
        liveSync(for: row)?.weeklyResetAtMs ?? row.planWeeklyResetAtMs
    }

    private func usageSourceSubtitle(for row: ProfileRow) -> String {
        liveSync(for: row) == nil ? "Claude account usage" : "Live subscription usage"
    }

    private func extraUsageText(spend: Double, limit: Double) -> String {
        String(format: "$%.2f of $%.2f extra usage", spend, limit)
    }
}
