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
            if let actionError = model.actionError {
                ActionErrorBanner(message: actionError) { model.dismissActionError() }
            }
            if let loadError = model.loadError {
                // Must come before the `rows.isEmpty` check below: a
                // config-read failure also leaves `rows` empty (see
                // `AppModel.load()`), and without this branch first the tab
                // would fall through to "No profiles yet" — telling the
                // user to add a profile that may already exist and simply
                // failed to read (Task 4 review, Important finding).
                LoadErrorView(model: model, error: loadError)
                    .frame(maxHeight: 220)
            } else if model.rows.isEmpty {
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

/// Renders `AppModel.actionError`, dismissibly. This is the fix for the
/// Critical finding on Task 3's review: the model already turned every
/// failure on the three new actions (add-api-key, add-subscription,
/// remove) into human copy via `message(for:)`, but nothing ever showed it —
/// sheets dismissed regardless of outcome and the string was set but never
/// read outside `AppModel`. `add-subscription`'s terminal-open failure and
/// poll timeout land here too, since that sheet always dismisses immediately
/// (see `AddSubscriptionSheet` below) and has nothing else on screen to show
/// the error once it's gone.
///
/// Not `private`: `FailoverTab` (Task 4) reuses it verbatim for the same
/// reason — the toggle/reorder actions go through the same `actionError`
/// published property via `perform`, and Task 3's Critical finding was
/// exactly a failure path that set the error but never rendered it.
struct ActionErrorBanner: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Dismiss")
        }
        .padding(10)
        .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// Opens `ccm add <name>` in Terminal, then polls. The Tauri version used
/// `window.prompt` here — which does nothing at all in a packaged webview, so
/// the feature was dead on arrival. A real SwiftUI form cannot fail that way.
///
/// Always dismisses on submit, success or failure: unlike `AddApiKeySheet`
/// there is nothing in this form worth correcting and resubmitting — a
/// terminal-open failure or a 5-minute poll timeout aren't caused by
/// anything typed here, and the poll itself takes far too long to hold a
/// modal sheet open for. Both failure paths (`AppModel.addSubscriptionProfile`)
/// land in `actionError`, surfaced by `ActionErrorBanner` in `ProfilesTab`
/// once this sheet is gone.
struct AddSubscriptionSheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name: String

    /// `initialName` exists so tests can pin the trim-at-submit fix (Task 3
    /// review, Minor finding) by presetting untrimmed `@State` up front —
    /// ViewInspector can't drive a live `TextField` edit through a plain
    /// `@State` without hosting the view in a real window loop, which this
    /// package has no need for elsewhere. Production call sites never pass
    /// this; it defaults to empty, same as before.
    init(model: AppModel, initialName: String = "") {
        self.model = model
        self._name = State(initialValue: initialName)
    }

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
                    let profileName = name.trimmingCharacters(in: .whitespaces)
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

/// Unlike `AddSubscriptionSheet`, a failure here (most commonly
/// `AlreadyExists` or a Keychain write failure) is directly correctable —
/// the user just needs a different name and to retype the key — so this
/// sheet stays open and shows the error inline instead of dismissing into
/// the banner behind it. `model.actionError` is cleared on `onAppear` so a
/// stale error from some earlier, unrelated action can't leak into a fresh
/// sheet before this one has submitted anything.
struct AddApiKeySheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var key = ""
    @State private var isSubmitting = false

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
            if let actionError = model.actionError {
                Label {
                    Text(actionError)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .foregroundStyle(.red)
                .font(.callout)
            }
            HStack {
                Spacer()
                Button("Cancel") {
                    key = ""
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
                Button(isSubmitting ? "Adding…" : "Add") {
                    submit()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(
                    isSubmitting
                        || name.trimmingCharacters(in: .whitespaces).isEmpty
                        || key.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .onAppear { model.dismissActionError() }
        .padding(16)
        .frame(width: 420)
    }

    private func submit() {
        let profileName = name
        let profileKey = key
        key = ""  // no key material outstanding past the round-trip
        isSubmitting = true
        Task {
            await model.addApiKeyProfile(name: profileName, key: profileKey)
            isSubmitting = false
            if model.actionError == nil {
                dismiss()
            }
        }
    }
}

/// Destructive and irreversible (the profile directory is deleted), so the user
/// has to type the name exactly — same bar as `ccm remove`.
///
/// Dismisses on submit regardless of outcome, unlike `AddApiKeySheet`: the
/// confirmation the user typed is already correct by the time "Remove" is
/// enabled (it matches `row.name`), so there is nothing about this form to
/// retype after a failure — a Keychain error here is a system-level problem,
/// not a form-input one. Failure lands in `actionError`, surfaced by
/// `ActionErrorBanner` once this sheet is gone.
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
