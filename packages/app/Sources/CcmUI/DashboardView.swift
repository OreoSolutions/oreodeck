import SwiftUI

public enum DashboardSection: String, CaseIterable, Identifiable {
    case profiles = "Profiles"
    case usage = "Usage"
    case failover = "Failover"
    case tools = "CLI & Tools"
    case settings = "Settings"

    public var id: String { rawValue }
    var icon: String {
        switch self {
        case .profiles: "person.crop.rectangle.stack"
        case .usage: "chart.bar.xaxis"
        case .failover: "arrow.triangle.branch"
        case .tools: "terminal"
        case .settings: "gearshape"
        }
    }
}

/// Modern sidebar dashboard keeping every primary workflow one click away.
public struct DashboardView: View {
    @ObservedObject private var model: AppModel
    @State private var section: DashboardSection = .profiles

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    OreoBrandMark()

                    VStack(alignment: .leading, spacing: 1) {
                        Text("OreoDeck").font(.headline).foregroundStyle(.white)
                        Text("Claude Code companion")
                            .font(.caption2)
                            .foregroundStyle(Color.white.opacity(0.58))
                    }
                }
                .padding(.horizontal, 8)

                VStack(spacing: 5) {
                    ForEach(DashboardSection.allCases) { item in
                        Button {
                            section = item
                        } label: {
                            HStack(spacing: 10) {
                                Capsule()
                                    .fill(section == item ? OreoTheme.terracotta : .clear)
                                    .frame(width: 3, height: 18)
                                Image(systemName: item.icon)
                                    .frame(width: 18)
                                Text(item.rawValue)
                                Spacer()
                            }
                            .font(.callout.weight(section == item ? .semibold : .regular))
                            .foregroundStyle(section == item ? OreoTheme.terracotta : Color.white.opacity(0.82))
                            .padding(.horizontal, 11)
                            .padding(.vertical, 9)
                            .background(
                                section == item ? OreoTheme.terracotta.opacity(0.11) : Color.clear,
                                in: RoundedRectangle(cornerRadius: 10)
                            )
                            // Plain buttons otherwise hit-test mostly around
                            // their visible icon/text. Make the entire sidebar
                            // row clickable, including its empty trailing area.
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        // Sidebar selection is already communicated by the
                        // cream background. Keeping AppKit's keyboard focus
                        // ring makes the previously clicked row look like a
                        // second active tab after selection changes.
                        .focusable(false)
                        .accessibilityAddTraits(section == item ? .isSelected : [])
                    }
                }

                Spacer()

                Button {
                    section = .settings
                    Task { await model.checkForUpdates() }
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("OreoDeck")
                            .font(.headline)
                            .foregroundStyle(.white)
                        HStack(spacing: 7) {
                            Text("v\(model.currentVersion)")
                            Image(systemName: updateStatusIcon)
                                .foregroundStyle(updateStatusColor)
                            Text(updateStatusText)
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    }
                    .padding(11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(OreoTheme.card.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .focusable(false)
                .accessibilityLabel("OreoDeck v\(model.currentVersion), \(updateStatusText). Open update settings")
                .help("Open update settings")

                HStack(spacing: 8) {
                    Image(systemName: model.cliMissing ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(model.cliMissing ? .orange : .green)
                    Text(model.cliMissing ? "CLI setup needed" : "CLI connected")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(OreoTheme.card.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityElement(children: .combine)
                .accessibilityLabel(model.cliMissing ? "CLI setup needed. Install ord to launch sessions." : "CLI connected. Ready to open sessions.")
                .help(model.cliMissing ? "Install ord to launch sessions" : "Ready to open sessions")
            }
            .padding(14)
            .frame(width: 210)
            .frame(maxHeight: .infinity)
            .background(OreoTheme.sidebar)

            Divider()

            Group {
                switch section {
                case .profiles: ProfilesTab(model: model)
                case .usage: UsageTab(model: model)
                case .failover: FailoverTab(model: model)
                case .tools: CLIToolsView(model: model)
                case .settings: SettingsView(model: model)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(OreoTheme.canvas)
        }
        .frame(minWidth: 920, minHeight: 620)
    }

    private var updateStatusText: String {
        if model.checkingForUpdate { return "Checking…" }
        if let update = model.availableUpdate { return "v\(update.version) available" }
        return "Latest"
    }

    private var updateStatusIcon: String {
        model.availableUpdate == nil ? "checkmark.circle.fill" : "arrow.down.circle.fill"
    }

    private var updateStatusColor: Color {
        model.availableUpdate == nil ? .green : .orange
    }
}
