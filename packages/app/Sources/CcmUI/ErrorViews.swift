import CcmKit
import SwiftUI

/// Shared "the last load failed" surface for the three dashboard tabs
/// (Profiles/Usage/Failover). Each tab renders this in place of its own
/// empty state whenever `AppModel.loadError` is set, so a config-read
/// failure (`listProfiles`/`getUsage`/`getFailover` throwing) is never
/// mistaken for "no profiles yet" — that misreport was the Task 4 review's
/// Important finding: profiles can genuinely exist and merely have failed to
/// read, and telling the user to go add one they already have is actively
/// misleading.
///
/// Mirrors `MenuBarView`'s already-correct "ccm can't read its config."
/// copy so the popover and the three tabs agree, and for `.ConfigCorrupt`
/// specifically offers the "Open config file" escape hatch the design always
/// intended (`docs/superpowers/plans/2026-07-17-ccm-swift-app.md`'s
/// `ConfigCorruptView`, never wired into a real view before this fix).
/// `switch`es on the typed `CcmError` — same invariant as `message(for:)` in
/// `Formatters.swift` — never a string compare.
public struct LoadErrorView: View {
    @ObservedObject private var model: AppModel
    private let error: CcmError

    public init(model: AppModel, error: CcmError) {
        self.model = model
        self.error = error
    }

    public var body: some View {
        switch error {
        case .ConfigCorrupt:
            // The one state where nothing on this tab can be trusted, so the
            // one thing that actually helps — opening the file — gets a
            // dedicated button, not just the generic retry every other
            // read error gets below.
            ContentUnavailableView {
                Label("ccm can't read its config", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message(for: error))
            } actions: {
                HStack {
                    Button("Open config file") { Task { await model.openConfigInEditor() } }
                        .buttonStyle(.borderedProminent)
                    Button("Try again") { Task { await model.load() } }
                }
            }
        case .InvalidName, .NotFound, .AlreadyExists, .Io, .Keychain:
            ContentUnavailableView {
                Label("ccm couldn't load your profiles", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message(for: error))
            } actions: {
                Button("Try again") { Task { await model.load() } }
            }
        }
    }
}
