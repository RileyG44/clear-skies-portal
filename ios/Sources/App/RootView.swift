import SwiftUI
import UIKit
import WebKit

/// Stage 2 of CR-001. The map and its native glass controls share one
/// composition surface; expanding a menu never substitutes an opaque modal.
struct RootView: View {
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    var portal: PortalModel
    @State private var keyboardHeight: CGFloat = 0
    @State private var toolbarVisibility = MapToolbarVisibility()

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
                PortalWebView(webView: portal.host.webView)
                    .ignoresSafeArea()
                MapChrome(toolbarHideProgress: toolbarVisibility.progress)
                    .padding(.bottom, portal.host.webView.window?.safeAreaInsets.bottom ?? 0)
                    .opacity(portal.ready ? 1 : 0)
                if !portal.ready {
                    LaunchCover(restoring: portal.restoring)
                }
                if let sheet = portal.shell.activeSheet {
                    FloatingToolsSheet(sheet: sheet, geometry: geometry, keyboardHeight: keyboardHeight,
                                       homeInset: portal.host.webView.window?.safeAreaInsets.bottom ?? 0)
                        .transition(reducedMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                        .zIndex(2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .coordinateSpace(name: "portal-map")
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .background(Color("CanvasBackground").ignoresSafeArea())
        .environment(portal.shell)
        .environment(\.portalAppearance, portal.shell.appearance)
        .tint(Color(hex: portal.shell.appearance.button) ?? .accentColor)
        .foregroundStyle(PortalPrimary())
        .portalFont(.body)
        .preferredColorScheme(appearance)
        .animation(.easeOut(duration: 0.35), value: portal.ready)
        .animation(reducedMotion ? nil : .spring(duration: 0.35, bounce: 0.12), value: portal.shell.activeSheet)
        .sensoryFeedback(.selection, trigger: portal.shell.feedback)
        .onPreferenceChange(MapToolbarVisibilityKey.self) { visibility in
            if visibility.dragging || reducedMotion {
                toolbarVisibility = visibility
            } else {
                withAnimation(.easeOut(duration: 0.24)) { toolbarVisibility = visibility }
            }
        }
        .onChange(of: portal.shell.activeSheet) {
            if portal.shell.activeSheet == nil { portal.host.webView.window?.endEditing(true) }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
            guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
                  let window = portal.host.webView.window else { return }
            let height = window.bounds.intersection(window.convert(frame, from: nil)).height
            let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
            withAnimation(reducedMotion ? nil : .easeOut(duration: duration)) { keyboardHeight = height }
        }
    }

    private var appearance: ColorScheme? {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "cspDebugAppearance") {
        case "light": return .light
        case "dark": return .dark
        default: break
        }
        #endif
        switch portal.shell.map.theme {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
}

private struct MapToolbarVisibility: Equatable, Sendable {
    var progress: CGFloat = 0
    var dragging = false
}

private struct MapToolbarVisibilityKey: PreferenceKey {
    nonisolated static let defaultValue = MapToolbarVisibility()
    nonisolated static func reduce(value: inout MapToolbarVisibility, nextValue: () -> MapToolbarVisibility) {
        value = nextValue()
    }
}

/// The home header includes the search row and optional coordinate actions.
/// Report its size; the sheet supplies the position in its own gesture space.
struct SheetHeaderHeightKey: PreferenceKey {
    nonisolated static let defaultValue: CGFloat = 0
    nonisolated static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// A native SwiftUI bottom sheet with the same Liquid Glass as the map dock.
/// Its two existing detents remain in ShellModel. List drags expand the medium
/// sheet and collapse it at the top; scrolled content keeps its native gestures.
/// Keyboard avoidance reduces the content height, not the top margin.
private struct FloatingToolsSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    let sheet: ShellModel.ActiveSheet
    let geometry: GeometryProxy
    let keyboardHeight: CGFloat
    let homeInset: CGFloat
    private enum DragAction {
        case resize(closeOnDown: Bool)
        case dismissKeyboard
        case ignore
    }
    @State private var drag: CGFloat = 0
    @State private var dragAction: DragAction?
    @State private var listAtTop = true
    @State private var headerHeight: CGFloat = 0

    private var resizing: Bool {
        if case .resize? = dragAction { return true }
        return false
    }

    private var expandedHeight: CGFloat { geometry.size.height * 0.9 }
    private var mediumHeight: CGFloat {
        verticalSizeClass == .compact ? expandedHeight :
            min(expandedHeight, (geometry.size.height + geometry.safeAreaInsets.top) * 0.5 + homeInset)
    }
    private var baseHeight: CGFloat { shell.detent == .expanded || keyboardHeight > 0 ? expandedHeight : mediumHeight }
    private var keyboardInset: CGFloat { max(0, keyboardHeight - geometry.safeAreaInsets.bottom) }
    private var contentHeight: CGFloat {
        min(max(0, geometry.size.height - keyboardInset - 4),
            max(160, min(expandedHeight, baseHeight - drag) - keyboardInset))
    }
    private var top: CGFloat { geometry.size.height - keyboardInset - 4 - contentHeight }
    private var toolbarHideProgress: CGFloat {
        if verticalSizeClass == .compact { return 1 }
        // Match ui-system.js: clear the dock over the first 120 points (or
        // half the remaining travel) as the menu rises above medium.
        let span = max(1, min(120, (expandedHeight - mediumHeight) * 0.5))
        return max(0, min(1, (baseHeight - drag - mediumHeight) / span))
    }

    var body: some View {
        Group {
            switch sheet {
            case .tools: ToolsSheet()
            case .panel(let id): PanelSheet(id: id)
            }
        }
        .frame(height: contentHeight)
        .background { SheetGlass() }
        .background {
            HeaderPanSurface(enabled: sheet == .tools && shell.path.isEmpty,
                             headerHeight: headerHeight, keyboardOpen: keyboardHeight > 0) { phase, translation, velocity, keyboardAtStart in
                switch phase {
                case .began:
                    if keyboardAtStart { shell.host?.webView.window?.endEditing(true) }
                case .changed:
                    if !keyboardAtStart { drag = max(0, translation) }
                case .ended:
                    withAnimation(reducedMotion ? nil : .spring(duration: 0.35, bounce: 0.12)) {
                        drag = 0
                        if !keyboardAtStart && (translation > 80 || (translation > 24 && velocity > 300)) {
                            shell.activeSheet = nil
                        }
                    }
                default: drag = 0
                }
            }
        }
        .clipShape(.rect(cornerRadius: 32))
        .environment(\.portalSheetSurface, true)
        .scrollDisabled(resizing)
        .onPreferenceChange(SheetScrollTopKey.self) { listAtTop = $0 }
        .onPreferenceChange(SheetHeaderHeightKey.self) { headerHeight = $0 }
        .contentShape(.rect)
        .preference(key: MapToolbarVisibilityKey.self,
                    value: MapToolbarVisibility(progress: toolbarHideProgress, dragging: drag != 0))
        .simultaneousGesture(DragGesture(minimumDistance: 12, coordinateSpace: .named("portal-map"))
            .onChanged { value in
                // Measure in the stationary map space, not in the moving
                // sheet. Otherwise moving the sheet changes the gesture's
                // translation and can reverse a resize on release.
                if dragAction == nil {
                    // A first update can have a zero/tied translation while
                    // focus or layout settles. Wait for a direction instead
                    // of rejecting the entire gesture from that update.
                    guard max(abs(value.translation.height), abs(value.translation.width)) >= 12 else { return }
                    guard abs(value.translation.height) > abs(value.translation.width) else {
                        dragAction = .ignore
                        return
                    }
                    let home = sheet == .tools && shell.path.isEmpty
                    let height = home && headerHeight > 0 ? headerHeight : 72
                    let header = (top...(top + height)).contains(value.startLocation.y)
                    // Home-header downward pans are owned by the native
                    // recognizer, which cancels the underlying button tap.
                    if home && header && value.translation.height > 0 {
                        dragAction = .ignore
                        return
                    }
                    if keyboardHeight > 0 {
                        // Keep this decision until the finger lifts. Hiding
                        // the keyboard changes keyboardHeight during the same
                        // swipe and must not turn it into a sheet dismissal.
                        if header && value.translation.height > 0 {
                            dragAction = .dismissKeyboard
                            shell.host?.webView.window?.endEditing(true)
                        } else {
                            dragAction = .ignore
                        }
                        return
                    }
                    let expand = shell.detent != .expanded && value.translation.height < 0
                    let collapse = listAtTop && value.translation.height > 0
                    dragAction = header || expand || collapse ? .resize(closeOnDown: home && header) : .ignore
                }
                guard resizing else { return }
                drag = value.translation.height
            }
            .onEnded { value in
                let action = dragAction
                dragAction = nil
                guard case .resize(let closeOnDown) = action else { return }
                withAnimation(reducedMotion ? nil : .spring(duration: 0.35, bounce: 0.12)) {
                    drag = 0
                    let travel = value.predictedEndTranslation.height
                    if travel < -40 { shell.detent = .expanded }
                    else if travel > 80 {
                        if closeOnDown { shell.activeSheet = nil }
                        else if shell.detent == .expanded { shell.detent = .medium }
                        else { shell.activeSheet = nil }
                    }
                }
            })
        .accessibilityAction(named: "Expand menu") { shell.detent = .expanded }
        .accessibilityAction(named: "Collapse menu") { shell.detent = .medium }
        .accessibilityAction(named: "Close menu") { shell.activeSheet = nil }
        .accessibilityAction(.escape) { shell.activeSheet = nil }
        #if DEBUG
        .onAppear { shell.host?.debugSheetVisible = true }
        .onDisappear { shell.host?.debugSheetVisible = false }
        #endif
        .padding(.horizontal, 4)
        .padding(.bottom, keyboardInset + 4)
        .animation(reducedMotion ? nil : .spring(duration: 0.35, bounce: 0.12), value: shell.detent)
    }
}

/// A window-level recognizer sees drags beginning over SwiftUI buttons and
/// the native text field. It begins only for a downward pan in this header;
/// native cancellation prevents the same touch from activating a shortcut.
private struct HeaderPanSurface: UIViewRepresentable {
    let enabled: Bool
    let headerHeight: CGFloat
    let keyboardOpen: Bool
    let action: (UIGestureRecognizer.State, CGFloat, CGFloat, Bool) -> Void

    final class Marker: UIView {
        var windowChanged: ((UIWindow?) -> Void)?
        override func didMoveToWindow() { super.didMoveToWindow(); windowChanged?(window) }
    }

    func makeUIView(context: Context) -> Marker {
        let view = Marker()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        context.coordinator.marker = view
        view.windowChanged = { [weak coordinator = context.coordinator] window in coordinator?.attach(to: window) }
        return view
    }
    func updateUIView(_ view: Marker, context: Context) { context.coordinator.parent = self }
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    static func dismantleUIView(_ view: Marker, coordinator: Coordinator) { coordinator.attach(to: nil) }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: HeaderPanSurface
        weak var marker: Marker?
        weak var window: UIWindow?
        private var keyboardAtStart = false
        private var touchStart = CGPoint.zero
        private lazy var pan: UIPanGestureRecognizer = {
            let recognizer = UIPanGestureRecognizer(target: self, action: #selector(handle(_:)))
            recognizer.delegate = self
            recognizer.cancelsTouchesInView = true
            recognizer.delaysTouchesBegan = false
            recognizer.delaysTouchesEnded = false
            recognizer.maximumNumberOfTouches = 1
            return recognizer
        }()
        init(parent: HeaderPanSurface) { self.parent = parent }
        func attach(to next: UIWindow?) {
            guard window !== next else { return }
            window?.removeGestureRecognizer(pan)
            window = next
            next?.addGestureRecognizer(pan)
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard parent.enabled, parent.headerHeight > 0, let marker, let window else { return false }
            let point = touch.location(in: marker)
            keyboardAtStart = parent.keyboardOpen
            touchStart = touch.location(in: window)
            #if DEBUG
            NSLog("HeaderPan receive x=%.1f y=%.1f height=%.1f keyboard=%d", point.x, point.y, parent.headerHeight, keyboardAtStart ? 1 : 0)
            #endif
            return point.x >= 0 && point.x <= marker.bounds.width && point.y >= 0
                && point.y <= min(parent.headerHeight, marker.bounds.height)
                && touch.window === window
        }
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            let point = pan.location(in: window)
            let direction = CGPoint(x: point.x - touchStart.x, y: point.y - touchStart.y)
            #if DEBUG
            NSLog("HeaderPan begin dx=%.1f dy=%.1f", direction.x, direction.y)
            #endif
            return direction.y > 0 && direction.y > abs(direction.x)
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
        @objc private func handle(_ sender: UIPanGestureRecognizer) {
            #if DEBUG
            if sender.state != .changed { NSLog("HeaderPan state=%ld dy=%.1f keyboard=%d", sender.state.rawValue, sender.translation(in: window).y, keyboardAtStart ? 1 : 0) }
            #endif
            parent.action(sender.state, sender.translation(in: window).y,
                          sender.velocity(in: window).y, keyboardAtStart)
        }
    }
}

struct PortalWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ webView: WKWebView, context: Context) {}
}
