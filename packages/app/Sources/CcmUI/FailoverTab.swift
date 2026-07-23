import CcmKit
import SwiftUI

public struct FailoverTab: View {
    @ObservedObject private var model: AppModel

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PageHeader(
                eyebrow: "Continuity",
                title: "Failover",
                subtitle: "Control automatic switching and the profile order used when limits are reached.",
                systemImage: "arrow.triangle.branch"
            )
            // Same banner `ProfilesTab` uses for the same reason (Task 3's
            // Critical finding): `setFailoverEnabled`/`moveFailover` route
            // through `perform`, which sets `actionError` on a rejected
            // toggle or reorder — a value nothing renders is a silent
            // failure, exactly what the old webview app shipped here.
            if let actionError = model.actionError {
                ActionErrorBanner(message: actionError) { model.dismissActionError() }
            }

            Toggle(
                "Switch to the next profile automatically when one hits its limit",
                isOn: Binding(
                    get: { model.failover.enabled },
                    set: { newValue in Task { await model.setFailoverEnabled(newValue) } }
                )
            )

            Text("Order — OreoDeck tries these top to bottom. Drag to reorder.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let loadError = model.loadError {
                // Must come before the `order.isEmpty` check below: a
                // config-read failure also leaves `failover.order` at
                // whatever it last was (possibly empty, e.g. on first
                // load), and without this branch first the tab would fall
                // through to "No profiles yet" — telling the user to add a
                // profile that may already exist and simply failed to read
                // (Task 4 review, Important finding).
                LoadErrorView(model: model, error: loadError)
            } else if model.failover.order.isEmpty {
                OreoEmptyState(
                    title: "No profiles yet",
                    message: "Add at least one profile before configuring automatic switching.",
                    systemImage: "arrow.triangle.branch",
                )
            } else {
                List {
                    ForEach(model.failover.order, id: \.self) { name in
                        HStack(spacing: 6) {
                            Image(systemName: "line.3.horizontal")
                                .foregroundStyle(.tertiary)
                            Text(name)
                        }
                    }
                    .onMove { offsets, destination in
                        Task { await model.moveFailover(fromOffsets: offsets, toOffset: destination) }
                    }
                }
            }

            CommandSuggestions(model: model, commands: [
                CLICommandSuggestion("ord failover show", "Inspect the current failover state and order."),
                CLICommandSuggestion("ord failover on", "Enable automatic failover."),
                CLICommandSuggestion("ord failover order <profile...>", "Set the complete fallback order."),
            ])
        }
        // No 30s timer here on purpose (unlike `ProfilesTab`/`UsageTab`):
        // spec §3 only requires auto-refresh for the popover, Profiles and
        // Usage surfaces. This tab is what the user is actively editing —
        // a background refresh reordering the list out from under a
        // half-finished drag would be a bad experience. `surfaceAppeared`
        // still loads once when the tab opens, via the same visibility gate
        // every other surface uses (`AppModel.visibleSurfaces`); it also
        // keeps counting toward `isRefreshing` so a still-visible Profiles
        // or Usage tab's own timer keeps refreshing normally.
        .onAppear { Task { await model.surfaceAppeared(.failoverTab) } }
        .onDisappear { model.surfaceDisappeared(.failoverTab) }
    }
}
