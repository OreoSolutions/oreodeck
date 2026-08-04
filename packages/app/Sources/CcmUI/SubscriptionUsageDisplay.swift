import CcmKit

/// The one display-safe source of truth for a subscription row. A successful
/// live OAuth fetch supersedes the persisted Claude snapshot; all other
/// states keep the snapshot visible without pretending it is live.
struct SubscriptionUsageDisplay {
    let fiveHourPercent: Double?
    let fiveHourResetAtMs: Int64?
    let weeklyPercent: Double?
    let weeklyResetAtMs: Int64?
    let limits: [SubscriptionUsageLimitView]
    let isLive: Bool

    init(row: ProfileRow, sync: SubscriptionUsageSyncView?) {
        let liveUsage = sync?.state == "connected" ? sync : nil

        fiveHourPercent = liveUsage?.fiveHourPercent ?? row.planFiveHourPercent
        fiveHourResetAtMs = liveUsage?.fiveHourResetAtMs ?? row.planFiveHourResetAtMs
        weeklyPercent = liveUsage?.weeklyPercent ?? row.planWeeklyPercent
        weeklyResetAtMs = liveUsage?.weeklyResetAtMs ?? row.planWeeklyResetAtMs
        let fallbackLimits = [
            SubscriptionUsageLimitView(
                id: "five_hour",
                label: "5-hour",
                percent: liveUsage?.fiveHourPercent ?? row.planFiveHourPercent,
                resetAtMs: liveUsage?.fiveHourResetAtMs ?? row.planFiveHourResetAtMs
            ),
            SubscriptionUsageLimitView(
                id: "seven_day",
                label: "Weekly",
                percent: liveUsage?.weeklyPercent ?? row.planWeeklyPercent,
                resetAtMs: liveUsage?.weeklyResetAtMs ?? row.planWeeklyResetAtMs
            ),
        ].filter { $0.percent != nil || $0.resetAtMs != nil }
        limits = sync?.limits.isEmpty == false ? sync?.limits ?? [] : fallbackLimits
        isLive = liveUsage != nil
    }
}
