import CcmKit
import Testing

@testable import CcmUI

@Test func mergeJoinsUsageOntoProfilesCaseInsensitivelyAndKeepsProfileOrder() {
    // get_usage() carries no `active` flag (spec §2 pins its fields), so the
    // join against list_profiles() is where "active" comes from. config.json
    // stores canonical casing and matches case-insensitively, so the join has
    // to as well.
    let profiles = [
        ProfileView(name: "Work", kind: "subscription", active: true),
        ProfileView(name: "bot", kind: "api-key", active: false),
    ]
    let usage = [
        ProfileUsageView(
            profile: "bot", kind: "api-key", inputTokens: 1, cacheWrite5mTokens: 2,
            cacheWrite1hTokens: 3, cacheReadTokens: 4, outputTokens: 5, totalTokens: 15,
            costUsd: 1.5, resetAtMs: 42, planFiveHourPercent: nil,
            planFiveHourResetAtMs: nil, planWeeklyPercent: nil,
            planWeeklyResetAtMs: nil, planUsageFetchedAtMs: nil),
        ProfileUsageView(
            profile: "work", kind: "subscription", inputTokens: 10, cacheWrite5mTokens: 0,
            cacheWrite1hTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 10,
            costUsd: 0, resetAtMs: nil, planFiveHourPercent: 75,
            planFiveHourResetAtMs: 100, planWeeklyPercent: 52,
            planWeeklyResetAtMs: 200, planUsageFetchedAtMs: 50),
    ]

    let rows = mergeRows(profiles: profiles, usage: usage)

    #expect(rows.map(\.name) == ["Work", "bot"])
    #expect(rows[0].active)
    #expect(rows[0].totalTokens == 10)
    #expect(rows[0].resetAtMs == nil)
    #expect(rows[0].planFiveHourPercent == 75)
    #expect(rows[0].planWeeklyResetAtMs == 200)
    #expect(rows[1].totalTokens == 15)
    #expect(rows[1].costUsd == 1.5)
    #expect(rows[1].resetAtMs == 42)
}

@Test func mergeKeepsAProfileWithNoUsageRowAtZero() {
    let rows = mergeRows(
        profiles: [ProfileView(name: "fresh", kind: "subscription", active: false)],
        usage: [])
    #expect(rows.count == 1)
    #expect(rows[0].totalTokens == 0)
    #expect(rows[0].resetAtMs == nil)
}
