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
                    ZStack {
                        Circle().fill(OreoTheme.chocolate)
                        Image(systemName: "circle.grid.3x3.fill")
                            .font(.title3)
                            .foregroundStyle(OreoTheme.cream)
                    }
                    .frame(width: 34, height: 34)

                    VStack(alignment: .leading, spacing: 1) {
                        Text("OreoDeck").font(.headline)
                        Text("Claude identity manager")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 8)

                VStack(spacing: 5) {
                    ForEach(DashboardSection.allCases) { item in
                        Button {
                            section = item
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: item.icon)
                                    .frame(width: 18)
                                Text(item.rawValue)
                                Spacer()
                            }
                            .font(.callout.weight(section == item ? .semibold : .regular))
                            .foregroundStyle(section == item ? OreoTheme.chocolate : Color.primary)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 9)
                            .background(
                                section == item ? OreoTheme.cream.opacity(0.72) : Color.clear,
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

                HStack(spacing: 7) {
                    Circle().fill(model.cliMissing ? Color.orange : OreoTheme.cyan)
                        .frame(width: 7, height: 7)
                    Text(model.cliMissing ? "CLI needs setup" : "CLI connected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 9)
            }
            .padding(14)
            .frame(width: 210)
            .frame(maxHeight: .infinity)
            .background(OreoTheme.card.opacity(0.55))

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
}
