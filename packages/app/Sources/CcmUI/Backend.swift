import CcmKit
import Foundation

/// Seam between the views and the Rust core. The live implementation is a thin
/// pass-through to the uniffi-generated free functions; tests inject a fake so
/// the view model can be exercised without touching ~/.ccm or the Keychain.
///
/// The generated functions are plain synchronous Swift functions with no actor
/// isolation, and uniffi emits conditional `Sendable` conformances for every
/// record and for CcmError — so no `@preconcurrency` and no actor wrapper is
/// needed under Swift 6 strict concurrency (verified by the spike).
public protocol CcmBackend: Sendable {
    func listProfiles() throws -> [ProfileView]
    func getUsage() throws -> [ProfileUsageView]
    func setActive(name: String) throws
    func addApiKeyProfile(name: String, key: String) throws
    func removeProfile(name: String) throws
    func getFailover() throws -> FailoverView
    func setFailoverEnabled(on: Bool) throws
    func setFailoverOrder(names: [String]) throws
    func openSession(name: String) throws
    func openLoginTerminal(name: String) throws
    func openConfigInEditor() throws
    func checkCli() -> Bool
}

public struct LiveBackend: CcmBackend {
    public init() {}

    public func listProfiles() throws -> [ProfileView] { try CcmKit.listProfiles() }
    public func getUsage() throws -> [ProfileUsageView] { try CcmKit.getUsage() }
    public func setActive(name: String) throws { try CcmKit.setActive(name: name) }
    public func addApiKeyProfile(name: String, key: String) throws {
        try CcmKit.addApiKeyProfile(name: name, key: key)
    }
    public func removeProfile(name: String) throws { try CcmKit.removeProfile(name: name) }
    public func getFailover() throws -> FailoverView { try CcmKit.getFailover() }
    public func setFailoverEnabled(on: Bool) throws { try CcmKit.setFailoverEnabled(on: on) }
    public func setFailoverOrder(names: [String]) throws {
        try CcmKit.setFailoverOrder(names: names)
    }
    public func openSession(name: String) throws { try CcmKit.openSession(name: name) }
    public func openLoginTerminal(name: String) throws { try CcmKit.openLoginTerminal(name: name) }
    public func openConfigInEditor() throws { try CcmKit.openConfigInEditor() }
    public func checkCli() -> Bool { CcmKit.checkCli() }
}
