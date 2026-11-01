import Foundation
import UserNotifications

typealias Callback = @convention(c) (UnsafePointer<CChar>) -> Void
private final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    let callback: Callback
    let center = UNUserNotificationCenter.current()
    init(_ callback: @escaping Callback) { self.callback = callback; super.init(); center.delegate = self }
    func emit(_ kind: String, _ fields: [String: Any] = [:]) {
        var event = fields
        event["kind"] = kind
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return }
        text.withCString { callback($0) }
    }
    func status() {
        center.getNotificationSettings { settings in
            self.emit("permission", ["authorization": settings.authorizationStatus.rawValue, "alert": settings.alertSetting.rawValue])
        }
        center.getDeliveredNotifications { items in
            self.emit("delivered", ["ids": items.map { $0.request.identifier }])
        }
    }
    func authorize() {
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            self.emit("authorization-result", ["granted": granted, "error": error != nil, "errorDomain": (error as NSError?)?.domain ?? "", "errorCode": (error as NSError?)?.code ?? 0]); self.status()
        }
    }
    func post() {
        let id = UUID().uuidString
        let content = UNMutableNotificationContent()
        content.title = "DSCanvas 测试通知"
        content.body = "点击返回通知应用。IDE 回跳尚未接入。"
        content.sound = .default
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
            self.emit(error == nil ? "submitted" : "submit-error", ["id": id])
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        emit("will-present", ["id": notification.request.identifier]); completionHandler([.banner, .list, .sound])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        emit("native-response", ["id": response.notification.request.identifier, "action": response.actionIdentifier]); completionHandler()
    }
}
private var notifications: Notifications?
@_cdecl("dsc_notifications_init")
public func initialize(_ callback: @escaping @convention(c) (UnsafePointer<CChar>) -> Void) {
    notifications = Notifications(callback)
}
@_cdecl("dsc_notifications_action")
public func action(_ value: Int32) {
    guard let n = notifications else { return }
    switch value {
    case 0: n.status()
    case 1: n.authorize()
    case 2: n.post()
    case 3:
        n.center.removeAllPendingNotificationRequests()
        n.center.removeAllDeliveredNotifications()
        n.emit("withdraw-requested")
    default: n.emit("unsupported")
    }
}
