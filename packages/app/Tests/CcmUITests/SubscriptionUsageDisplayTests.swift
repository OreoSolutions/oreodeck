import CcmKit
import Testing
import ViewInspector

@testable import CcmUI

@Test func connectedOAuthUsageWinsOverTheCachedSnapshot() {
    let display = SubscriptionUsageDisplay(
        row: subscriptionRow(fiveHour: 1, weekly: 2),
        sync: subscriptionSync(state: "connected", fiveHour: 8, weekly: 96)
    )

    #expect(display.fiveHourPercent == 8)
    #expect(display.weeklyPercent == 96)
    #expect(display.isLive)
}

@Test func nonConnectedOAuthUsageKeepsTheCachedSnapshot() {
    let display = SubscriptionUsageDisplay(
        row: subscriptionRow(fiveHour: 1, weekly: 2),
        sync: subscriptionSync(state: "cannot-verify", fiveHour: 8, weekly: 96)
    )

    #expect(display.fiveHourPercent == 1)
    #expect(display.weeklyPercent == 2)
    #expect(!display.isLive)
}

@MainActor
@Test func menuBarShowsBothConnectedLiveUsageWindows() async throws {
    let backend = FakeBackend()
    backend.set(
        profiles: [ProfileView(name: "work", kind: "subscription", active: true)],
        usage: [
            ProfileUsageView(
                profile: "work", kind: "subscription",
                inputTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0,
                cacheReadTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0,
                resetAtMs: nil, planFiveHourPercent: 1, planFiveHourResetAtMs: 3_600_000,
                planWeeklyPercent: 2, planWeeklyResetAtMs: 176_400_000,
                planUsageFetchedAtMs: 0
            ),
        ]
    )
    backend.set(
        subscriptionUsageSync: subscriptionSync(state: "connected", fiveHour: 8, weekly: 96),
        for: "work"
    )
    let model = AppModel(backend: backend)
    await model.load()
    await model.refreshSubscriptionUsage(name: "work", force: true)

    let view = MenuBarView(model: model, openDashboard: {})
    #expect(try view.inspect().find(text: "5h 8% · Week 96%").string() == "5h 8% · Week 96%")
    #expect(throws: (any Error).self) {
        try view.inspect().find(text: "5h 1% · Week 2%")
    }
}

@MainActor
@Test func subscriptionProfileDetailRendersEveryLiveLimitReportedByClaude() throws {
    let status = SubscriptionUsageSyncStatus(
        row: subscriptionRow(fiveHour: 8, weekly: 96),
        sync: subscriptionSync(
            state: "connected",
            fiveHour: 8,
            weekly: 96,
            limits: [
                SubscriptionUsageLimitView(
                    id: "five_hour", label: "5-hour", percent: 8, resetAtMs: 7_200_000
                ),
                SubscriptionUsageLimitView(
                    id: "seven_day", label: "Weekly", percent: 96, resetAtMs: 352_800_000
                ),
                SubscriptionUsageLimitView(
                    id: "seven_day_fable", label: "Fable weekly", percent: 63, resetAtMs: 176_400_000
                ),
            ]
        ),
        nowMs: 0,
        refresh: {},
        loginAgain: {}
    )

    let inspected = try status.inspect()
    #expect(try inspected.find(text: "Fable weekly").string() == "Fable weekly")
    #expect(try inspected.find(text: "63% used").string() == "63% used")
    #expect(try inspected.find(text: "Resets in 2d 1h").string() == "Resets in 2d 1h")
}

private func subscriptionRow(fiveHour: Double, weekly: Double) -> ProfileRow {
    ProfileRow(
        name: "work",
        kind: "subscription",
        active: true,
        planFiveHourPercent: fiveHour,
        planFiveHourResetAtMs: 3_600_000,
        planWeeklyPercent: weekly,
        planWeeklyResetAtMs: 176_400_000
    )
}

private func subscriptionSync(
    state: String,
    fiveHour: Double,
    weekly: Double,
    limits: [SubscriptionUsageLimitView] = []
) -> SubscriptionUsageSyncView {
    SubscriptionUsageSyncView(
        state: state,
        message: "Connected — subscription usage is live.",
        fetchedAtMs: 0,
        retryAfterMs: nil,
        fiveHourPercent: fiveHour,
        fiveHourResetAtMs: 7_200_000,
        weeklyPercent: weekly,
        weeklyResetAtMs: 352_800_000,
        extraUsageSpendUsd: nil,
        extraUsageLimitUsd: nil,
        limits: limits
    )
}
