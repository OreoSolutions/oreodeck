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

    /// `key` is key material. It is handed to the core and forgotten here: it
    /// is never stored on the model, never logged, and never interpolated into
    /// an error. The view clears its `SecureField` the moment this returns.
    public func addApiKeyProfile(name: String, key: String) async {
        let backend = self.backend
        await perform { try backend.addApiKeyProfile(name: name, key: key) }
    }

    /// Opens `ccm add <name>` in Terminal (the OAuth /login flow only works in
    /// a real terminal) and then polls the config until the profile shows up —
    /// there is no callback from Terminal, so polling is the only signal.
    ///
    /// `pollInterval`/`timeout` are parameters rather than an injected Clock:
    /// tests pass milliseconds and stay fast, at the cost of not being able to
    /// assert the exact production cadence. Worth it — the flow being alive at
    /// all is what matters, and that is what the Tauri version got wrong.
    ///
    /// Both the terminal launch and each poll's read go through the same
    /// off-actor hop as every other backend call on this class (`load()` /
    /// `perform()`) — `open_login_terminal` spawns a process and `load()`
    /// walks config + transcripts, neither of which may run on the main actor.
    public func addSubscriptionProfile(
        name: String,
        pollInterval: Duration = .seconds(2),
        timeout: Duration = .seconds(300)
    ) async {
        let backend = self.backend
        do {
            try await Task.detached { try backend.openLoginTerminal(name: name) }.value
        } catch let error as CcmError {
            actionError = message(for: error)
            return
        } catch {
            actionError = "Terminal could not be opened."
            return
        }

        pendingSubscription = name
        defer { pendingSubscription = nil }

        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            do {
                try await Task.sleep(for: pollInterval)
            } catch {
                return  // cancelled
            }
            await load()
            if rows.contains(where: { $0.name.lowercased() == name.lowercased() }) {
                actionError = nil
                return
            }
        }
        actionError =
            "Timed out waiting for \"\(name)\" to finish logging in. Finish the login in Terminal, then reopen this window."
    }

    /// The canonicalize → Keychain → store ordering lives in the core
    /// (`api::remove_profile_with`) and is pinned by its own Rust tests. Do not
    /// second-guess any part of it from here.
    public func removeProfile(name: String) async {
        let backend = self.backend
        await perform { try backend.removeProfile(name: name) }
    }
}
