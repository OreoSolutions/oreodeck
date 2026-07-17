import CcmKit
import SwiftUI

public struct ProfilesTab: View {
    @ObservedObject private var model: AppModel

    @State private var selection: ProfileRow.ID?
    @State private var showAddSubscription = false
    @State private var showAddApiKey = false
    @State private var rowPendingRemoval: ProfileRow?

    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    public init(model: AppModel) {
        self.model = model
    }

    private var selectedRow: ProfileRow? {
        model.rows.first { $0.id == selection }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.rows.isEmpty {
                ContentUnavailableView(
                    "No profiles yet",
                    systemImage: "person.2",
                    description: Text("Add a subscription profile to log in with your Claude account, or an API key profile.")
                )
                .frame(maxHeight: 220)
            } else {
                Table(model.rows, selection: $selection) {
                    TableColumn("Profile") { row in
                        HStack(spacing: 6) {
                            Image(systemName: row.active ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(row.active ? Color.accentColor : Color.secondary)
                                .accessibilityLabel(row.active ? "Active" : "Inactive")
                            Text(row.name)
                        }
                    }
                    TableColumn("Kind") { row in
                        Text(row.kind == "api-key" ? "API key" : "Subscription")
                    }
                    TableColumn("Tokens (5h)") { row in
                        Text(formatTokens(row.totalTokens)).monospacedDigit()
                    }
                    TableColumn("Cost") { row in
                        Text(formatCost(kind: row.kind, costUsd: row.costUsd)).monospacedDigit()
                    }
                    TableColumn("Resets in") { row in
                        Text(formatCountdown(resetAtMs: row.resetAtMs, nowMs: model.nowMs))
                            .monospacedDigit()
                    }
                }
            }

            HStack(spacing: 8) {
                Button("Set active") {
                    guard let name = selectedRow?.name else { return }
                    Task { await model.setActive(name: name) }
                }
                .disabled(selectedRow == nil || selectedRow!.active)
                Button("Open session") {
                    guard let name = selectedRow?.name else { return }
                    Task { await model.openSession(name: name) }
                }
                .disabled(selectedRow == nil || model.cliMissing)
                Button("Remove…", role: .destructive) { rowPendingRemoval = selectedRow }
                    .disabled(selectedRow == nil)
                Spacer()
                Button("Add subscription…") { showAddSubscription = true }
                Button("Add API key…") { showAddApiKey = true }
            }

            if let pending = model.pendingSubscription {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Waiting for \"\(pending)\" to finish logging in in Terminal…")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .onAppear { Task { await model.surfaceAppeared(.profilesTab) } }
        .onDisappear { model.surfaceDisappeared(.profilesTab) }
        .onReceive(timer) { _ in Task { await model.tick() } }
        .sheet(isPresented: $showAddSubscription) {
            AddSubscriptionSheet(model: model)
        }
        .sheet(isPresented: $showAddApiKey) {
            AddApiKeySheet(model: model)
        }
        .sheet(item: $rowPendingRemoval) { row in
            RemoveProfileSheet(model: model, row: row)
        }
    }
}

/// Opens `ccm add <name>` in Terminal, then polls. The Tauri version used
/// `window.prompt` here — which does nothing at all in a packaged webview, so
/// the feature was dead on arrival. A real SwiftUI form cannot fail that way.
struct AddSubscriptionSheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""

    var body: some View {
        Form {
            Text("A Terminal window will open and run `ccm add \(name.isEmpty ? "<name>" : name)`. Finish the login there; this window picks the profile up automatically.")
                .foregroundStyle(.secondary)
            TextField("Profile name", text: $name)
                .textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Open Terminal") {
                    let profileName = name
                    dismiss()
                    Task { await model.addSubscriptionProfile(name: profileName) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(16)
        .frame(width: 420)
    }
}

struct AddApiKeySheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var key = ""

    var body: some View {
        Form {
            TextField("Profile name", text: $name)
                .textFieldStyle(.roundedBorder)
            // SecureField, not TextField: the key must never be shown on
            // screen, and it is wiped from this view's state on submit.
            SecureField("API key", text: $key)
                .textFieldStyle(.roundedBorder)
            Text("The key goes straight into the macOS Keychain (service com.oreo.ccm). It is never written to config.json.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel") {
                    key = ""
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
                Button("Add") {
                    let profileName = name
                    let profileKey = key
                    key = ""  // no key material outstanding past the round-trip
                    dismiss()
                    Task { await model.addApiKeyProfile(name: profileName, key: profileKey) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(
                    name.trimmingCharacters(in: .whitespaces).isEmpty
                        || key.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(16)
        .frame(width: 420)
    }
}

/// Destructive and irreversible (the profile directory is deleted), so the user
/// has to type the name exactly — same bar as `ccm remove`.
struct RemoveProfileSheet: View {
    @ObservedObject var model: AppModel
    let row: ProfileRow
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""

    var body: some View {
        Form {
            Text("Removing \"\(row.name)\" deletes its login, settings and history, and its API key in the Keychain. This can't be undone.")
            TextField("Type \(row.name) to confirm", text: $typed)
                .textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Remove", role: .destructive) {
                    let profileName = row.name
                    dismiss()
                    Task { await model.removeProfile(name: profileName) }
                }
                .disabled(typed != row.name)
            }
        }
        .padding(16)
        .frame(width: 440)
    }
}
