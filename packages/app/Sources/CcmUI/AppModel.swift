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
/// what the old webview app had to do for its 6 blocking commands.
@MainActor
public final class AppModel: ObservableObject {
    /// A surface that, while on screen, wants the 30s refresh running.
    public enum Surface: Hashable, Sendable {
        case popover
        case profilesTab
        case usageTab
        case failoverTab
        case toolsTab
        case settingsTab
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
    @Published public private(set) var terminal = "terminal"
    @Published public private(set) var availableUpdate: OreoUpdateRelease?
    @Published public private(set) var checkingForUpdate = false
    /// Name of the subscription profile whose Terminal login we're polling for.
    @Published public private(set) var pendingSubscription: String?
    /// Refreshed on every load so countdowns re-render without their own clock.
    @Published public private(set) var nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)

    /// Test-visible proof of the refresh gate.
    public private(set) var loadCount = 0

    private let backend: CcmBackend
    private var visibleSurfaces: Set<Surface> = []
    /// Monotonic generation: overlapping timer/action loads may finish out of
    /// order, but an older snapshot must never overwrite newer UI state.
    private var latestLoadID: UInt64 = 0

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
        latestLoadID &+= 1
        let loadID = latestLoadID
        nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let backend = self.backend
        do {
            let result = try await Task.detached {
                let cliInstalled = backend.checkCli()
                let profiles = try backend.listProfiles()
                let usage = try backend.getUsage()
                let failover = try backend.getFailover()
                let terminal = try backend.getTerminal()
                return (cliInstalled, profiles, usage, failover, terminal)
            }.value
            guard loadID == latestLoadID else { return }
            cliMissing = !result.0
            rows = mergeRows(profiles: result.1, usage: result.2)
            failover = result.3
            terminal = result.4
            loadError = nil
        } catch let error as CcmError {
            guard loadID == latestLoadID else { return }
            loadError = error
            rows = []
        } catch {
            guard loadID == latestLoadID else { return }
            loadError = .Io(message: "Something went wrong reading the OreoDeck config.")
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

    public func setSharedResources(name: String, resources: [String]) async {
        let backend = self.backend
        await perform { try backend.setSharedResources(name: name, resources: resources) }
    }

    public func setSharedResourcesForce(name: String, resources: [String]) async {
        let backend = self.backend
        await perform { try backend.setSharedResourcesForce(name: name, resources: resources) }
    }

    public func openSession(name: String) async {
        let backend = self.backend
        await perform { try backend.openSession(name: name) }
    }

    public func setTerminal(_ value: String) async {
        let backend = self.backend
        await perform { try backend.setTerminal(value: value) }
    }

    public func openTerminalCommand(_ command: String) async {
        let backend = self.backend
        do {
            try await Task.detached { try backend.openTerminalCommand(command: command) }.value
            actionError = nil
        } catch let error as CcmError {
            actionError = message(for: error)
        } catch {
            actionError = "The selected terminal could not be opened."
        }
    }

    public func openConfigInEditor() async {
        let backend = self.backend
        await perform { try backend.openConfigInEditor() }
    }

    public var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.7"
    }

    public func checkForUpdates() async {
        guard !checkingForUpdate else { return }
        checkingForUpdate = true
        defer { checkingForUpdate = false }
        do {
            availableUpdate = try await OreoUpdateService.newerVersion(currentVersion: currentVersion)
        } catch {
            // Network update checks are advisory and must never make the app unusable.
        }
    }

    public func installAvailableUpdate() async {
        guard availableUpdate != nil else { return }
        await openTerminalCommand("ord update")
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
    /// all is what matters, and that is what the old webview app got wrong.
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

    /// Deviation from the Task 4 brief: the brief's snippet declares this
    /// (and `moveFailover` below) synchronous. Same rationale as the Task 3
    /// deviation noted in `AppModelTests.swift` — that predates the Task 2
    /// Critical fix (a659d42) that made every backend-touching method on this
    /// class `async` and route through `perform`'s `Task.detached` hop.
    /// Staying synchronous here would mean either blocking the main actor on
    /// the FFI call or firing a bare `Task {}` straight at the backend, both
    /// of which the established pattern (and its doc comment above) rules
    /// out. `FailoverTab`'s `Toggle`/`List.onMove` closures are themselves
    /// synchronous, so the view wraps these calls in `Task { await ... }`,
    /// same as every button in `ProfilesTab`.
    public func setFailoverEnabled(_ on: Bool) async {
        let backend = self.backend
        await perform { try backend.setFailoverEnabled(on: on) }
    }

    /// `.onMove` hands us offsets; the core takes the whole ordered list (and
    /// restores canonical casing + appends any profile the list forgot), so we
    /// apply the move locally and send the result wholesale — never a diff.
    /// On rejection `perform` never mutates `failover` (it only reloads after
    /// a *successful* write), so a failed write or a failed post-write reload
    /// both leave `failover.order` exactly where it was: reverted to backend
    /// truth, with the failure surfaced via `actionError`/`loadError`.
    public func moveFailover(fromOffsets: IndexSet, toOffset: Int) async {
        var mutableOrder = failover.order
        mutableOrder.move(fromOffsets: fromOffsets, toOffset: toOffset)
        let order = mutableOrder
        let backend = self.backend
        await perform { try backend.setFailoverOrder(names: order) }
    }
}
