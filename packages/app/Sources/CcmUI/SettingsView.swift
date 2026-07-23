import SwiftUI

private struct TerminalOption: Identifiable {
    let id: String
    let name: String
    let subtitle: String
    let icon: String
    let supportsCommands: Bool

    init(id: String, name: String, subtitle: String, icon: String, supportsCommands: Bool = true) {
        self.id = id
        self.name = name
        self.subtitle = subtitle
        self.icon = icon
        self.supportsCommands = supportsCommands
    }
}

public struct SettingsView: View {
    @ObservedObject private var model: AppModel

    private let terminals = [
        TerminalOption(
            id: "terminal", name: "Terminal.app",
            subtitle: "The terminal included with macOS.", icon: "apple.terminal.fill"),
        TerminalOption(
            id: "ghostty", name: "Ghostty",
            subtitle: "Open commands in a new Ghostty window.", icon: "bolt.fill"),
        TerminalOption(
            id: "iterm2", name: "iTerm2",
            subtitle: "Create a new iTerm2 window using its AppleScript integration.", icon: "terminal.fill"),
        TerminalOption(
            id: "wezterm", name: "WezTerm",
            subtitle: "Start OreoDeck in a new WezTerm process.", icon: "chevron.left.forwardslash.chevron.right"),
        TerminalOption(
            id: "alacritty", name: "Alacritty",
            subtitle: "Run commands in a new Alacritty window.", icon: "speedometer"),
        TerminalOption(
            id: "kitty", name: "Kitty",
            subtitle: "Open a new Kitty OS window and keep its shell available.", icon: "pawprint.fill"),
        TerminalOption(
            id: "warp", name: "Warp",
            subtitle: "Window only — run the OreoDeck command manually.", icon: "arrow.right.square.fill", supportsCommands: false),
        TerminalOption(
            id: "hyper", name: "Hyper",
            subtitle: "Window only — run the OreoDeck command manually.", icon: "rectangle.and.hand.point.up.left.fill", supportsCommands: false),
        TerminalOption(
            id: "tabby", name: "Tabby",
            subtitle: "Window only — run the OreoDeck command manually.", icon: "square.stack.3d.up.fill", supportsCommands: false),
        TerminalOption(
            id: "rio", name: "Rio",
            subtitle: "Window only — run the OreoDeck command manually.", icon: "hare.fill", supportsCommands: false),
        TerminalOption(
            id: "wave", name: "Wave Terminal",
            subtitle: "Window only — run the OreoDeck command manually.", icon: "waveform", supportsCommands: false),
    ]

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(
                    eyebrow: "Preferences",
                    title: "Settings",
                    subtitle: "Choose how OreoDeck integrates with your local development environment.",
                    systemImage: "gearshape.fill"
                )

                if let actionError = model.actionError {
                    ActionErrorBanner(message: actionError) { model.dismissActionError() }
                }

                OreoCard {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Default terminal").font(.headline)
                                Text("Used for sessions, profile login, and every Run in Terminal action.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            StatusPill(text: selectedTerminalName, color: OreoTheme.cyan)
                        }

                        VStack(spacing: 8) {
                            ForEach(terminals) { terminal in
                                Button {
                                    Task { await model.setTerminal(terminal.id) }
                                } label: {
                                    HStack(spacing: 12) {
                                        ZStack {
                                            RoundedRectangle(cornerRadius: 10)
                                                .fill(
                                                    model.terminal == terminal.id
                                                        ? OreoTheme.cream.opacity(0.75)
                                                        : Color.primary.opacity(0.05)
                                                )
                                            Image(systemName: terminal.icon)
                                                .foregroundStyle(
                                                    model.terminal == terminal.id
                                                        ? OreoTheme.chocolate : Color.secondary)
                                        }
                                        .frame(width: 38, height: 38)

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(terminal.name).font(.callout.weight(.semibold))
                                            Text(terminal.subtitle)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: model.terminal == terminal.id
                                            ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(model.terminal == terminal.id
                                                ? OreoTheme.cyan : Color.secondary)
                                    }
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(
                                        model.terminal == terminal.id
                                            ? OreoTheme.cream.opacity(0.18) : Color.clear,
                                        in: RoundedRectangle(cornerRadius: 12)
                                    )
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .focusable(false)
                            }
                        }

                        if selectedTerminal?.supportsCommands == false {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                                Text("This terminal can only be opened as a new window. Run the OreoDeck command manually inside it.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                        }

                        Divider()

                        HStack {
                            Label(
                                "The selected terminal must be installed in Applications. iTerm2 may request Automation access.",
                                systemImage: "info.circle"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            Spacer()
                            Button {
                                Task {
                                    await model.openTerminalCommand(
                                        "echo 'OreoDeck terminal integration is ready.'")
                                }
                            } label: {
                                Label("Test terminal", systemImage: "play.fill")
                            }
                            .buttonStyle(OreoPrimaryButtonStyle())
                        }
                    }
                }

                OreoCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Software update").font(.headline)
                                Text("Installed version \(model.currentVersion)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let update = model.availableUpdate {
                                StatusPill(text: "v\(update.version) available", color: .orange)
                            } else {
                                StatusPill(text: "Up to date", color: OreoTheme.cyan)
                            }
                        }
                        Text("OreoDeck checks GitHub Releases and uses the CLI updater to download and verify the release checksum before installation.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        HStack {
                            Spacer()
                            Button {
                                Task { await model.checkForUpdates() }
                            } label: {
                                Label(model.checkingForUpdate ? "Checking…" : "Check now", systemImage: "arrow.clockwise")
                            }
                            .disabled(model.checkingForUpdate)
                            if model.availableUpdate != nil {
                                Button {
                                    Task { await model.installAvailableUpdate() }
                                } label: {
                                    Label("Update in Terminal", systemImage: "arrow.down.circle.fill")
                                }
                                .buttonStyle(OreoPrimaryButtonStyle())
                            }
                        }
                    }
                }
            }
            .padding(2)
        }
        .onAppear {
            Task {
                await model.surfaceAppeared(.settingsTab)
                await model.checkForUpdates()
            }
        }
        .onDisappear { model.surfaceDisappeared(.settingsTab) }
    }

    private var selectedTerminalName: String {
        selectedTerminal?.name ?? "Terminal.app"
    }

    private var selectedTerminal: TerminalOption? {
        terminals.first(where: { $0.id == model.terminal })
    }
}
