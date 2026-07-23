import CcmKit
import Foundation

/// One line of the Profiles table / menu-bar list: `list_profiles()` (identity
/// + active flag) joined with `get_usage()` (numbers).
public struct ProfileRow: Identifiable, Equatable, Sendable {
    public var name: String
    public var kind: String
    public var active: Bool
    public var inputTokens: Int64
    public var cacheWrite5mTokens: Int64
    public var cacheWrite1hTokens: Int64
    public var cacheReadTokens: Int64
    public var outputTokens: Int64
    public var totalTokens: Int64
    public var costUsd: Double
    public var resetAtMs: Int64?
    public var planFiveHourPercent: Double?
    public var planFiveHourResetAtMs: Int64?
    public var planWeeklyPercent: Double?
    public var planWeeklyResetAtMs: Int64?
    public var planUsageFetchedAtMs: Int64?
    public var sharedResources: [String]

    public var id: String { name }

    public init(
        name: String, kind: String, active: Bool, inputTokens: Int64 = 0,
        cacheWrite5mTokens: Int64 = 0, cacheWrite1hTokens: Int64 = 0, cacheReadTokens: Int64 = 0,
        outputTokens: Int64 = 0, totalTokens: Int64 = 0, costUsd: Double = 0,
        resetAtMs: Int64? = nil, planFiveHourPercent: Double? = nil,
        planFiveHourResetAtMs: Int64? = nil, planWeeklyPercent: Double? = nil,
        planWeeklyResetAtMs: Int64? = nil, planUsageFetchedAtMs: Int64? = nil,
        sharedResources: [String] = []
    ) {
        self.name = name
        self.kind = kind
        self.active = active
        self.inputTokens = inputTokens
        self.cacheWrite5mTokens = cacheWrite5mTokens
        self.cacheWrite1hTokens = cacheWrite1hTokens
        self.cacheReadTokens = cacheReadTokens
        self.outputTokens = outputTokens
        self.totalTokens = totalTokens
        self.costUsd = costUsd
        self.resetAtMs = resetAtMs
        self.planFiveHourPercent = planFiveHourPercent
        self.planFiveHourResetAtMs = planFiveHourResetAtMs
        self.planWeeklyPercent = planWeeklyPercent
        self.planWeeklyResetAtMs = planWeeklyResetAtMs
        self.planUsageFetchedAtMs = planUsageFetchedAtMs
        self.sharedResources = sharedResources
    }
}

/// Joins on the profile name, case-insensitively — config.json stores the
/// canonical casing and the whole contract matches case-insensitively (APFS is
/// case-insensitive by default). Order follows `profiles`, which is
/// config.json's order. A profile with no usage row reads as all-zero rather
/// than disappearing.
public func mergeRows(profiles: [ProfileView], usage: [ProfileUsageView]) -> [ProfileRow] {
    var byName: [String: ProfileUsageView] = [:]
    for u in usage { byName[u.profile.lowercased()] = u }

    return profiles.map { p in
        let u = byName[p.name.lowercased()]
        return ProfileRow(
            name: p.name,
            kind: p.kind,
            active: p.active,
            inputTokens: u?.inputTokens ?? 0,
            cacheWrite5mTokens: u?.cacheWrite5mTokens ?? 0,
            cacheWrite1hTokens: u?.cacheWrite1hTokens ?? 0,
            cacheReadTokens: u?.cacheReadTokens ?? 0,
            outputTokens: u?.outputTokens ?? 0,
            totalTokens: u?.totalTokens ?? 0,
            costUsd: u?.costUsd ?? 0,
            resetAtMs: u?.resetAtMs,
            planFiveHourPercent: u?.planFiveHourPercent,
            planFiveHourResetAtMs: u?.planFiveHourResetAtMs,
            planWeeklyPercent: u?.planWeeklyPercent,
            planWeeklyResetAtMs: u?.planWeeklyResetAtMs,
            planUsageFetchedAtMs: u?.planUsageFetchedAtMs,
            sharedResources: p.sharedResources
        )
    }
}
