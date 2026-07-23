import Foundation
import Testing

@testable import CcmUI

@Test func updateVersionComparisonIsNumeric() {
    #expect(OreoUpdateService.compare("0.2.0", "0.1.9") == .orderedDescending)
    #expect(OreoUpdateService.compare("1.0.0", "1.0.0") == .orderedSame)
    #expect(OreoUpdateService.compare("1.0.0", "1.0.1") == .orderedAscending)
}
