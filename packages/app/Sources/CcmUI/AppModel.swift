import CcmKit
import Foundation
import SwiftUI

/// Single source of truth for every surface (menu-bar popover + the three
/// dashboard tabs). `@MainActor` because it feeds SwiftUI directly; the uniffi
/// calls are synchronous and actor-agnostic, so they can be made from here
/// without any wrapper (verified by the spike).
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

    public func surfaceAppeared(_ surface: Surface) {
        visibleSurfaces.insert(surface)
        load()
    }

    public func surfaceDisappeared(_ surface: Surface) {
        visibleSurfaces.remove(surface)
    }

    /// Called by each surface's 30s timer. Gated: with nothing on screen this
    /// is a no-op, so a closed popover never walks the transcript tree.
    public func tick() {
        guard isRefreshing else { return }
        load()
    }

    public func load() {
        loadCount += 1
        nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        cliMissing = !backend.checkCli()
        do {
            let profiles = try backend.listProfiles()
            let usage = try backend.getUsage()
            rows = mergeRows(profiles: profiles, usage: usage)
            failover = try backend.getFailover()
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

    /// Runs a user action, reloads on success, and turns any typed failure into
    /// human copy. Nothing here ever touches key material.
    func perform(_ action: () throws -> Void) {
        do {
            try action()
            actionError = nil
            load()
        } catch let error as CcmError {
            actionError = message(for: error)
        } catch {
            actionError = "The action could not be completed."
        }
    }

    public func setActive(name: String) {
        perform { try backend.setActive(name: name) }
    }

    public func openSession(name: String) {
        perform { try backend.openSession(name: name) }
    }

    public func openConfigInEditor() {
        perform { try backend.openConfigInEditor() }
    }
}
