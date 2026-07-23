import CcmKit
import Foundation

extension ProfileView {
    init(name: String, kind: String, active: Bool) {
        self.init(name: name, kind: kind, active: active, sharedResources: [])
    }
}

/// Polls `condition` until it becomes true instead of racing a fixed-duration
/// `Task.sleep` against however long a spawned `Task` takes to get its first
/// scheduling slot — the pattern that made
/// `addSubscriptionOpensTerminalThenPollsUntilTheProfileAppears` flaky (~19%
/// failure rate under `swift-testing`'s parallel execution, see the Task 3
/// review). `timeout` is only a safety bound for a genuinely broken/hanging
/// case; it never lengthens a passing run, unlike bumping a fixed sleep does.
@MainActor
func waitUntil(
    timeout: Duration = .seconds(2),
    pollEvery: Duration = .milliseconds(2),
    _ condition: () -> Bool
) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while !condition() {
        if ContinuousClock.now >= deadline { return false }
        try? await Task.sleep(for: pollEvery)
    }
    return true
}
