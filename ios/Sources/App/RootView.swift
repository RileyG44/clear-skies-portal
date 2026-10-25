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
    @State private var drag: CGFloat = 0
    @State private var resizing: Bool?
    @State private var listAtTop = true

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
        .padding(.top, 16)
        .padding(.bottom, keyboardHeight == 0 ? homeInset : 0)
        .frame(height: contentHeight)
        .background { SheetGlass() }
        .clipShape(.rect(cornerRadius: 32))
        .environment(\.portalSheetSurface, true)
        .scrollDisabled(resizing == true)
        .onPreferenceChange(SheetScrollTopKey.self) { listAtTop = $0 }
        .contentShape(.rect)
        .preference(key: MapToolbarVisibilityKey.self,
                    value: MapToolbarVisibility(progress: toolbarHideProgress, dragging: drag != 0))
        .simultaneousGesture(DragGesture(minimumDistance: 12, coordinateSpace: .named("portal-map"))
            .onChanged { value in
                // Measure in the stationary map space, not in the moving
                // sheet. Otherwise moving the sheet changes the gesture's
                // translation and can reverse a resize on release.
                if resizing == nil {
                    guard abs(value.translation.height) > abs(value.translation.width) else {
                        resizing = false
                        return
                    }
                    let header = (top...(top + 72)).contains(value.startLocation.y)
                    let expand = shell.detent != .expanded && value.translation.height < 0
                    let collapse = listAtTop && value.translation.height > 0
                    resizing = keyboardHeight == 0 && (header || expand || collapse)
                }
                guard resizing == true else { return }
                drag = value.translation.height
            }
            .onEnded { value in
                let resize = resizing == true
                resizing = nil
                guard resize else { return }
                withAnimation(reducedMotion ? nil : .spring(duration: 0.35, bounce: 0.12)) {
                    drag = 0
                    let travel = value.predictedEndTranslation.height
                    if travel < -40 { shell.detent = .expanded }
                    else if travel > 80 {
                        if shell.detent == .expanded { shell.detent = .medium }
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

struct PortalWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ webView: WKWebView, context: Context) {}
}
