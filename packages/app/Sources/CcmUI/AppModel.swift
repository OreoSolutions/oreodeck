import CcmKit
import Foundation
import SwiftUI

/// Single source of truth for every surface (menu-bar popover + the three
/// dashboard tabs). `@MainActor` because it feeds SwiftUI directly. The uniffi
/// calls themselves are synchronous, actor-agnostic Swift functions (verified
/// by the spike — no wrapper needed for *data-race* safety), but several of
/// them do real blocking IO on the calling thread: `getUsage` walks every
/// profile's transcript directory (`core-rs/src/api.rs` documents "callers on
/// a UI thread must hop off it themselves"), and the action calls
/// (`setActive`, `openSession`, `openConfigInEditor`, ...) do keychain IO,
/// process spawns, or config writes. Every call that reaches the backend is
/// therefore made from a `Task.detached` hop, never directly on this actor —
/// only the published-state assignment after `await` runs here. This mirrors
/// what the Tauri version had to do for its 6 blocking commands.
@MainActor
public final class AppModel: ObservableObject {
    /// A surface that, while on screen, wants the 30s refresh running.
    public enum Surface: Hashable, Sendable {
        case popover
        case profilesTab
        case usageTab
        case failoverTab
    }

    @Published public private(set) var rows: [ProfileRow] = []
    @Published public private(set) var failover = FailoverView(enabled: true, order: [])
    /// The error from the last data load. Typed on purpose: views `switch` on
    /// it, they never read its text to decide anything.
    @Published public private(set) var loadError: CcmError?
    /// Copy for the last failed user action (already rendered via
    /// `message(for:)`); shown in a dismissible banner, not a fatal state.
    @Published public private(set) var actionError: String?
    @Published public private(set) var cliMissing = false
    /// Name of the subscription profile whose Terminal login we're polling for.
    @Published public private(set) var pendingSubscription: String?
    /// Refreshed on every load so countdowns re-render without their own clock.
    @Published public private(set) var nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)

    /// Test-visible proof of the refresh gate.
    public private(set) var loadCount = 0

    private let backend: CcmBackend
    private var visibleSurfaces: Set<Surface> = []

    public init(backend: CcmBackend) {
        self.backend = backend
    }

    public var isRefreshing: Bool { !visibleSurfaces.isEmpty }

    public func surfaceAppeared(_ surface: Surface) async {
        visibleSurfaces.insert(surface)
        await load()
    }

    public func surfaceDisappeared(_ surface: Surface) {
        visibleSurfaces.remove(surface)
    }

    /// Called by each surface's 30s timer. Gated: with nothing on screen this
    /// is a no-op, so a closed popover never walks the transcript tree.
    public func tick() async {
        guard isRefreshing else { return }
        await load()
    }

    /// Every backend call here is documented-or-suspected blocking (see the
    /// class doc), so the whole batch runs inside one `Task.detached` — off
    /// the main actor — and only the results cross back over `await` to be
    /// assigned to the `@Published` properties.
    public func load() async {
        loadCount += 1
        nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let backend = self.backend
        do {
            let result = try await Task.detached {
                let cliInstalled = backend.checkCli()
                let profiles = try backend.listProfiles()
                let usage = try backend.getUsage()
                let failover = try backend.getFailover()
                return (cliInstalled, profiles, usage, failover)
            }.value
            cliMissing = !result.0
            rows = mergeRows(profiles: result.1, usage: result.2)
            failover = result.3
            loadError = nil
        } catch let error as CcmError {
            loadError = error
            rows = []
        } catch {
            loadError = .Io(message: "Something went wrong reading the ccm config.")
        }
    }

    public func dismissActionError() {
        actionError = nil
    }

    /// Runs a user action off the main actor, reloads on success, and turns
    /// any typed failure into human copy. Nothing here ever touches key
    /// material. `action` must not capture `self` — call sites hoist `backend`
    /// into a local so the closure stays `Sendable` without making `AppModel`
    /// itself `Sendable`.
    func perform(_ action: @escaping @Sendable () throws -> Void) async {
        do {
            try await Task.detached { try action() }.value
            actionError = nil
            await load()
        } catch let error as CcmError {
            actionError = message(for: error)
        } catch {
            actionError = "The action could not be completed."
        }
    }

    public func setActive(name: String) async {
        let backend = self.backend
        await perform { try backend.setActive(name: name) }
    }

    public func openSession(name: String) async {
        let backend = self.backend
        await perform { try backend.openSession(name: name) }
    }

    public func openConfigInEditor() async {
        let backend = self.backend
        await perform { try backend.openConfigInEditor() }
    }
}
