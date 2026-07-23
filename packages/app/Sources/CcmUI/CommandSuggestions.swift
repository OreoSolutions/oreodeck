import SwiftUI

public struct CLICommandSuggestion: Identifiable, Hashable {
    public let id = UUID()
    public let command: String
    public let description: String

    public init(_ command: String, _ description: String) {
        self.command = command
        self.description = description
    }
}

public struct CommandSuggestions: View {
    @ObservedObject private var model: AppModel
    let title: String
    let commands: [CLICommandSuggestion]
    @State private var copiedCommand: String?

    public init(model: AppModel, title: String = "Try it in Terminal", commands: [CLICommandSuggestion]) {
        self.model = model
        self.title = title
        self.commands = commands
    }

    public var body: some View {
        OreoCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(title, systemImage: "terminal.fill")
                        .font(.headline)
                    Spacer()
                    Text("CLI suggestions")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ForEach(commands) { item in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.command)
                                .font(.system(.callout, design: .monospaced).weight(.medium))
                                .textSelection(.enabled)
                            Text(item.description)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(item.command, forType: .string)
                            copiedCommand = item.command
                        } label: {
                            Image(systemName: copiedCommand == item.command ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(.borderless)
                        .help("Copy command")
                        Button {
                            Task { await model.openTerminalCommand(item.command) }
                        } label: {
                            Image(systemName: "arrow.up.right.square")
                        }
                        .buttonStyle(.borderless)
                        .help("Run in Terminal")
                    }
                    if item.id != commands.last?.id { Divider() }
                }
            }
        }
    }
}
