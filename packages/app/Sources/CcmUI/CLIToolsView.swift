import SwiftUI

public struct CLIToolsView: View {
    @ObservedObject private var model: AppModel

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(
                    eyebrow: "Power tools",
                    title: "CLI & integrations",
                    subtitle: "Configure shell routing, tab-local profiles, the optional UI and package lifecycle.",
                    systemImage: "terminal.fill"
                )

                HStack(spacing: 14) {
                    OreoCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("CLI status", systemImage: "checkmark.seal.fill")
                                .font(.headline)
                            StatusPill(
                                text: model.cliMissing ? "Not found on PATH" : "Installed",
                                color: model.cliMissing ? .orange : .green
                            )
                            Text(model.cliMissing
                                ? "Run install.sh from the release package before opening sessions."
                                : "Both oreodeck and ord can manage the same profiles as this app.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    OreoCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Selection priority", systemImage: "list.number")
                                .font(.headline)
                            Text("1. -P override\n2. Tab-local profile\n3. Global active profile")
                                .font(.callout.monospaced())
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                CommandSuggestions(model: model, title: "Shell & tab setup", commands: [
                    CLICommandSuggestion(
                        "oreodeck shell-init >> ~/.zshrc && source ~/.zshrc",
                        "Route the plain claude command through OreoDeck."
                    ),
                    CLICommandSuggestion(
                        "ord use --tab work",
                        "Pin a profile only in the current Terminal tab."
                    ),
                    CLICommandSuggestion("type claude", "Verify that claude resolves to the OreoDeck shell function."),
                ])

                CommandSuggestions(model: model, title: "Optional app", commands: [
                    CLICommandSuggestion("ord ui install", "Install the cached OreoDeck.app without Bun or Rust."),
                    CLICommandSuggestion("ord ui open", "Open the installed dashboard."),
                    CLICommandSuggestion("ord ui remove", "Remove only the UI while keeping CLI and profiles."),
                    CLICommandSuggestion("ord update --check", "Check GitHub Releases for a newer OreoDeck version."),
                    CLICommandSuggestion("ord update", "Download, verify and install an available update."),
                ])

                CommandSuggestions(model: model, title: "Package lifecycle", commands: [
                    CLICommandSuggestion("ord uninstall", "Remove app, CLI and shell integration while preserving profiles."),
                    CLICommandSuggestion("ord uninstall --purge", "Permanently remove OreoDeck and every managed profile."),
                ])
            }
            .padding(2)
        }
        .onAppear { Task { await model.surfaceAppeared(.toolsTab) } }
        .onDisappear { model.surfaceDisappeared(.toolsTab) }
    }
}
