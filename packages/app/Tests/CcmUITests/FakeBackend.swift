import CcmKit
import Foundation

@testable import CcmUI

/// Records every call and lets each one be scripted. Reference type + a lock so
/// it satisfies `Sendable` without any of the tests needing to think about it.
final class FakeBackend: CcmBackend, @unchecked Sendable {
    private let lock = NSLock()
    private var _profiles: [ProfileView] = []
    private var _usage: [ProfileUsageView] = []
    private var _failover = FailoverView(enabled: true, order: [])
    private var _cliInstalled = true
    private var _listError: CcmError?

    private(set) var listCallCount = 0
    private(set) var setActiveCalls: [String] = []
    private(set) var openSessionCalls: [String] = []
    private(set) var openLoginTerminalCalls: [String] = []
    private(set) var removeCalls: [String] = []
    private(set) var addApiKeyCalls: [(name: String, key: String)] = []
    private(set) var setFailoverEnabledCalls: [Bool] = []
    private(set) var setFailoverOrderCalls: [[String]] = []
    private(set) var openConfigCallCount = 0

    var addApiKeyError: CcmError?
    var removeError: CcmError?
    var setActiveError: CcmError?
    var openSessionError: CcmError?
    var setFailoverEnabledError: CcmError?
    var setFailoverOrderError: CcmError?

    func set(profiles: [ProfileView], usage: [ProfileUsageView] = []) {
        lock.withLock {
            _profiles = profiles
            _usage = usage
        }
    }
    func set(failover: FailoverView) { lock.withLock { _failover = failover } }
    func set(cliInstalled: Bool) { lock.withLock { _cliInstalled = cliInstalled } }
    func set(listError: CcmError?) { lock.withLock { _listError = listError } }

    /// Appends a profile as if `ccm add <name>` had just finished a login in
    /// Terminal — this is what the add-subscription poll is waiting for.
    func simulateLoginCompleted(name: String) {
        lock.withLock {
            _profiles.append(ProfileView(name: name, kind: "subscription", active: false))
        }
    }

    func listProfiles() throws -> [ProfileView] {
        try lock.withLock {
            listCallCount += 1
            if let _listError { throw _listError }
            return _profiles
        }
    }
    func getUsage() throws -> [ProfileUsageView] {
        try lock.withLock {
            if let _listError { throw _listError }
            return _usage
        }
    }
    func setActive(name: String) throws {
        try lock.withLock {
            setActiveCalls.append(name)
            if let setActiveError { throw setActiveError }
        }
    }
    func addApiKeyProfile(name: String, key: String) throws {
        try lock.withLock {
            addApiKeyCalls.append((name, key))
            if let addApiKeyError { throw addApiKeyError }
            _profiles.append(ProfileView(name: name, kind: "api-key", active: false))
        }
    }
    func removeProfile(name: String) throws {
        try lock.withLock {
            removeCalls.append(name)
            if let removeError { throw removeError }
            _profiles.removeAll { $0.name.lowercased() == name.lowercased() }
        }
    }
    func getFailover() throws -> FailoverView {
        try lock.withLock {
            if let _listError { throw _listError }
            return _failover
        }
    }
    func setFailoverEnabled(on: Bool) throws {
        try lock.withLock {
            setFailoverEnabledCalls.append(on)
            if let setFailoverEnabledError { throw setFailoverEnabledError }
            _failover = FailoverView(enabled: on, order: _failover.order)
        }
    }
    func setFailoverOrder(names: [String]) throws {
        try lock.withLock {
            setFailoverOrderCalls.append(names)
            if let setFailoverOrderError { throw setFailoverOrderError }
            _failover = FailoverView(enabled: _failover.enabled, order: names)
        }
    }
    func openSession(name: String) throws {
        try lock.withLock {
            openSessionCalls.append(name)
            if let openSessionError { throw openSessionError }
        }
    }
    func openLoginTerminal(name: String) throws {
        lock.withLock { openLoginTerminalCalls.append(name) }
    }
    func openConfigInEditor() throws { lock.withLock { openConfigCallCount += 1 } }
    func checkCli() -> Bool { lock.withLock { _cliInstalled } }
}
