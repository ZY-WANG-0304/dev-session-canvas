import AppKit
import UserNotifications

// Isolated platform probe. No IDE commands, source credentials or production data.
final class Probe: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    private var window: NSWindow!
    private let status = NSTextField(wrappingLabelWithString: "原生通知能力验证；尚未连接 IDE")
    private let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("DSCanvas Notifier Probe", isDirectory: true)
    private var lastIDs = [String]()

    private func record(_ kind: String, _ value: String = "") {
        DispatchQueue.main.async { [self] in
            let line = "\(ISO8601DateFormatter().string(from: Date())) \(kind) \(value)\n"
            status.stringValue = line
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let file = directory.appendingPathComponent("events.log")
                if let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 1_048_576 {
                    let previous = directory.appendingPathComponent("events.previous.log")
                    try? FileManager.default.removeItem(at: previous)
                    try FileManager.default.moveItem(at: file, to: previous)
                }
                if !FileManager.default.fileExists(atPath: file.path) {
                    FileManager.default.createFile(atPath: file.path, contents: nil)
                }
                let handle = try FileHandle(forWritingTo: file)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: Data(line.utf8))
            } catch { status.stringValue = "日志写入失败：\(error)" }
        }
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        center.delegate = self
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 300),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "DSCanvas Notifier · 平台验证"
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(NSTextField(labelWithString: "macOS 原生通知能力验证"))
        for (title, action) in [("查询权限与已送达通知", #selector(query)),
                                ("请求通知权限", #selector(authorize)),
                                ("发送测试通知 A", #selector(postA)),
                                ("发送测试通知 B", #selector(postB)),
                                ("撤销本探针通知", #selector(withdraw))] {
            stack.addArrangedSubview(NSButton(title: title, target: self, action: action))
        }
        stack.addArrangedSubview(status)
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 20)
        ])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        record("launch", "pid=\(ProcessInfo.processInfo.processIdentifier)")
        query()
    }

    @objc private func query() {
        center.getNotificationSettings { settings in
            self.record("permission", "authorization=\(settings.authorizationStatus.rawValue) alert=\(settings.alertSetting.rawValue)")
        }
        center.getDeliveredNotifications { notifications in
            self.record("delivered", notifications.map { $0.request.identifier }.sorted().joined(separator: ","))
        }
    }

    @objc private func authorize() {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            self.record("authorization-result", "granted=\(granted) error=\(error != nil)")
            self.query()
        }
    }

    private func post(_ source: String) {
        let identifier = "\(source)-\(UUID().uuidString)"
        lastIDs.append(identifier)
        let content = UNMutableNotificationContent()
        content.title = "DSCanvas 测试来源 \(source)"
        content.body = "点击验证原生回调；此探针尚未连接 IDE 节点。"
        content.sound = .default
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        center.add(request) { error in
            self.record(error == nil ? "submitted" : "submit-error", identifier)
        }
    }
    @objc private func postA() { post("A") }
    @objc private func postB() { post("B") }
    @objc private func withdraw() {
        // Only this probe's dedicated application identity is affected.
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
        lastIDs.removeAll()
        record("withdraw-requested")
        // Query separately: removal is asynchronous and has no completion callback.
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        record("will-present", notification.request.identifier)
        completionHandler([.banner, .list, .sound])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        record("native-response", "id=\(response.notification.request.identifier) action=\(response.actionIdentifier)")
        DispatchQueue.main.async { [self] in
            window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        completionHandler()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
let delegate = Probe()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
