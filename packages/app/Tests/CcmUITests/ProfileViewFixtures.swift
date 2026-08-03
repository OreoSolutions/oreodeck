import CcmKit

extension ProfileView {
    init(name: String, kind: String, active: Bool, sharedResources: [String] = []) {
        self.init(
            name: name,
            kind: kind,
            active: active,
            sharedResources: sharedResources,
            modelMappings: nil
        )
    }
}
