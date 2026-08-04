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
                            if active.kind == "subscription" {
                                StatusPill(
                                    text: subscriptionUsageDisplay(for: active).fiveHourPercent.map { "\(Int($0.rounded()))% used" } ?? "Ready",
                                    color: subscriptionUsageDisplay(for: active).fiveHourPercent ?? 0 >= 90 ? .red : OreoTheme.terracotta
                                )
                            } else {
                                HStack(spacing: 10) {
                                    Text("\(formatTokens(active.totalTokens)) local tokens")
                                        .monospacedDigit()
                                    Text(usageCost(active))
                                        .monospacedDigit()
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        profileUsageDetail(for: active)
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
                    ForEach(model.rows.filter { !$0.active }) { row in
                        OreoSectionCard(row.name, subtitle: "Profile usage") {
                            HStack {
                                Text(row.name).font(.headline)
                                Spacer()
                                if row.kind == "api-key" || row.kind == "gateway" {
                                    let cost = usageCost(row)
                                    Text("\(formatTokens(row.totalTokens)) local tokens")
                                        .monospacedDigit()
                                    Text(cost)
                                        .monospacedDigit()
                                        .foregroundStyle(.secondary)
                                } else if let fetchedAt = row.planUsageFetchedAtMs {
                                    Text("updated \(formatAge(timestampMs: fetchedAt, nowMs: model.nowMs))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            profileUsageDetail(for: row)
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

    private func subscriptionUsageDisplay(for row: ProfileRow) -> SubscriptionUsageDisplay {
        SubscriptionUsageDisplay(row: row, sync: model.subscriptionUsageSyncs[row.name])
    }

    private func usageSourceSubtitle(for row: ProfileRow) -> String {
        subscriptionUsageDisplay(for: row).isLive ? "Live subscription usage" : "Claude account usage"
    }

    @ViewBuilder
    private func profileUsageDetail(for row: ProfileRow) -> some View {
        if row.kind == "subscription" {
            SubscriptionUsageSyncStatus(
                row: row,
                sync: model.subscriptionUsageSyncs[row.name],
                nowMs: model.nowMs,
                refresh: { Task { await model.refreshSubscriptionUsage(name: row.name, force: true) } },
                loginAgain: { Task { await model.loginAgain(name: row.name) } }
            )
            if let extraUsage = model.subscriptionUsageSyncs[row.name],
               extraUsage.state == "connected",
               let spend = extraUsage.extraUsageSpendUsd,
               let limit = extraUsage.extraUsageLimitUsd {
                Text(extraUsageText(spend: spend, limit: limit))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            if model.subscriptionUsageSyncs[row.name]?.state != "connected", row.planUsageFetchedAtMs == nil {
                Text("No live usage yet. Refresh to connect through Claude OAuth.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else {
            UsageBar(row: row)
        }
    }

    private func extraUsageText(spend: Double, limit: Double) -> String {
        String(format: "$%.2f of $%.2f extra usage", spend, limit)
    }

    private func usageCost(_ row: ProfileRow) -> String {
        formatCost(kind: row.kind, costUsd: row.costUsd)
    }
}
