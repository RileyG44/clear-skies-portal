import SwiftUI
import UniformTypeIdentifiers

private enum MapControlSize {
    static let tool: CGFloat = 48
    static let search: CGFloat = 52
    static let imagery: CGFloat = 44
    static let status: CGFloat = 44
    static let icon: CGFloat = 17
}

/// Everything drawn over the map: the map tools, the terrain status, and the
/// search capsule the sheet collapses into.
struct MapChrome: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    var toolbarHideProgress: CGFloat = 0
    @State private var locationActionsExpanded = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VStack(alignment: .trailing, spacing: 0) {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 10) {
                            TerrainStatusCapsule()
                            if shell.map.pointCloud && shell.hasLocation { LocationShareButton() }
                        }
                        Spacer(minLength: 0)
                        MapTools(maxHeight: geometry.size.height - MapControlSize.search - (locationActionsExpanded ? 324 : 0) - 20)
                            .opacity(1 - toolbarHideProgress)
                            .scaleEffect(reducedMotion ? 1 : 1 - 0.04 * toolbarHideProgress, anchor: .topTrailing)
                            .offset(x: reducedMotion ? 0 : 12 * toolbarHideProgress)
                            .allowsHitTesting(toolbarHideProgress < 0.99)
                            .accessibilityHidden(toolbarHideProgress >= 0.99)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 6)
                    Spacer(minLength: 0)
                }
                VStack {
                    Spacer()
                    if shell.activeSheet == nil, !shell.mapBusy {
                        SearchCapsule(actionsExpanded: $locationActionsExpanded, maxActionHeight: max(44, geometry.size.height - MapControlSize.search - 22))
                            .padding(.horizontal, 14)
                            .padding(.bottom, 6)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                Toasts()
            }
            .animation(.spring(duration: 0.4, bounce: 0.18), value: shell.activeSheet == nil && !shell.mapBusy)
        }
    }
}

/// Preserve the dock's order; use balanced columns when a short view cannot
/// fit the tools above the search bar.
struct MapTools: View {
    @Environment(ShellModel.self) private var shell
    @Namespace private var glass
    @State private var draggedID: String?
    let maxHeight: CGFloat

    var body: some View {
        let tools = shell.dock.filter { $0.hidden != true }
        let height = CGFloat(tools.count) * MapControlSize.tool + CGFloat(max(0, tools.count - 1))
        let columns = height > maxHeight ? 2 : 1
        let rows = (tools.count + columns - 1) / columns
        GlassEffectContainer(spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                ForEach(0..<columns, id: \.self) { index in
                    let column = Array(tools.dropFirst(index * rows).prefix(rows))
                    VStack(spacing: 0) {
                        ForEach(column) { tool in
                            ToolButton(tool: tool)
                                .glassEffectID(tool.id, in: glass)
                                .onDrag {
                                    draggedID = tool.id
                                    let provider = NSItemProvider()
                                    provider.registerDataRepresentation(forTypeIdentifier: DockDrop.type.identifier, visibility: .ownProcess) { complete in
                                        complete(Data(tool.id.utf8), nil)
                                        return nil
                                    }
                                    return provider
                                }
                                .onDrop(of: [DockDrop.type], delegate: DockDrop(shell: shell, target: tool.id, draggedID: $draggedID))
                                .accessibilityHint("Touch and hold, then drag to reorder")
                                .accessibilityAction(named: "Move earlier") { move(tool.id, by: -1) }
                                .accessibilityAction(named: "Move later") { move(tool.id, by: 1) }
                            if tool.id != column.last?.id {
                                Divider().frame(width: 24).opacity(0.5)
                            }
                        }
                    }
                    .menuGlass(in: .capsule)
                }
            }
        }
        .animation(.spring(duration: 0.35, bounce: 0.2), value: tools.map(\.id))
    }

    private func move(_ id: String, by delta: Int) {
        let tools = shell.dock.filter { $0.hidden != true }
        if let index = tools.firstIndex(where: { $0.id == id }) { shell.moveTool(id, to: index + delta) }
    }
}

/// Native drag previews follow the finger; neighbouring tools settle into the
/// new order immediately, using the same saved order as the web dock.
private struct DockDrop: DropDelegate {
    static let type = UTType(exportedAs: "dev.riley.ClearSkies.map-tool")
    let shell: ShellModel
    let target: String
    @Binding var draggedID: String?

    func validateDrop(info: DropInfo) -> Bool {
        draggedID != nil && info.hasItemsConforming(to: [Self.type])
    }
    func dropEntered(info: DropInfo) {
        guard validateDrop(info: info), let id = draggedID, id != target,
              let index = shell.dock.filter({ $0.hidden != true }).firstIndex(where: { $0.id == target }) else { return }
        shell.moveTool(id, to: index)
    }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func performDrop(info: DropInfo) -> Bool { draggedID = nil; return true }
}

struct ToolButton: View {
    @Environment(ShellModel.self) private var shell
    @State private var showingModes = false
    let tool: DockTool

    var body: some View {
        if tool.tool == "mapMode" {
            // Menu reserves a long press for drag-to-select. A button-backed
            // popover leaves that gesture available to the reorderable dock.
            Button { showingModes = true } label: {
                glyph(Symbols.tool(tool.tool, mode: shell.map.mode, theme: shell.map.theme))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(tool.title)
            .popover(isPresented: $showingModes, arrowEdge: .trailing) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Map view")
                        .portalFont(.caption, weight: .semibold)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                    modeButton("2d", "2D map", "Explore layers on a flat map", "map")
                    modeButton("3d", "3D terrain", "Tilt and explore the terrain", "mountain.2")
                    modeButton("points", "Point cloud", "View individual LiDAR returns", "circle.grid.3x3")
                }
                .padding(8)
                .foregroundStyle(PortalPrimary())
                .environment(\.colorScheme, shell.map.theme == "dark" ? .dark : .light)
                .preferredColorScheme(shell.map.theme == "dark" ? .dark : .light)
                .presentationCompactAdaptation(.popover)
            }
        } else {
            Button { shell.tool(tool) } label: { glyph(Symbols.tool(tool.tool, mode: shell.map.mode, theme: shell.map.theme)) }
                .buttonStyle(.plain)
                .disabled(tool.disabled == true)
                .accessibilityLabel(tool.title)
                .accessibilityAddTraits(tool.pressed == true ? .isSelected : [])
        }
    }

    private func modeButton(_ mode: String, _ title: String, _ detail: String, _ symbol: String) -> some View {
        Button { showingModes = false; shell.setMode(mode) } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).portalFont(.body, weight: .medium)
                    Text(detail).portalFont(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "checkmark")
                    .fontWeight(.semibold)
                    .opacity(shell.map.mode == mode ? 1 : 0)
            }
            .padding(12)
            .frame(minWidth: 260, minHeight: 44, alignment: .leading)
            .background(shell.map.mode == mode ? Color.primary.opacity(0.06) : .clear,
                        in: .rect(cornerRadius: 14))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(shell.map.mode == mode ? .isSelected : [])
    }

    private func glyph(_ symbol: String) -> some View {
        let panel = ShellModel.toolPanels[tool.tool]
        let active = tool.tool != "theme" && (tool.pressed == true || tool.expanded == true || (panel != nil && shell.presentedPanel == panel))
        return Image(systemName: symbol)
            .font(.system(size: MapControlSize.icon, weight: .medium))
            .foregroundStyle(active ? AnyShapeStyle(.tint) : AnyShapeStyle(PortalPrimary()))
            .rotationEffect(.degrees(tool.tool == "bearing" ? -shell.map.bearing : 0))
            .frame(width: MapControlSize.tool, height: MapControlSize.tool)
            .contentShape(.rect)
            .overlay(alignment: .topTrailing) {
                if tool.tool == "server", let dot = tool.dot {
                    Circle()
                        .fill(dot == "on" ? Color.green : Color.secondary)
                        .frame(width: 6, height: 6)
                        .overlay(Circle().strokeBorder(.background, lineWidth: 1))
                        .offset(x: -9, y: 9)
                }
            }
    }
}

/// What the terrain is doing right now, in the web's own words: loading,
/// refining, ready, or partly unavailable, with the sources actually drawn.
/// It stays a small round icon (a spinner while loading, a seal matching the
/// menu text once ready) and opens to the full line only when tapped.
struct TerrainStatusCapsule: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.portalAppearance) private var appearance
    @State private var expanded = false

    var body: some View {
        if let terrain = shell.status.terrain, !terrain.text.isEmpty {
            let parts = Self.parts(of: terrain.text)
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    icon(terrain.state)
                        .portalFont(.footnote)
                    if expanded {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(parts.title)
                                .portalFont(.caption, weight: .medium)
                                .contentTransition(.interpolate)
                            if !parts.detail.isEmpty {
                                Text(parts.detail)
                                    .portalFont(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                        .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .leading)))
                    }
                }
                .padding(.horizontal, expanded ? 12 : 0)
                .padding(.vertical, expanded ? 8 : 0)
                .frame(minWidth: MapControlSize.status, minHeight: MapControlSize.status)
                .frame(maxWidth: expanded ? 250 : MapControlSize.status, alignment: expanded ? .leading : .center)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .chromeGlass(in: .capsule)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(terrain.text)
            .accessibilityHint(expanded ? "Hide terrain details" : "Show terrain details")
        }
    }

    /// Ready means every terrain tile in view loaded. Partial, offline and
    /// error keep their own icons rather than claiming a ready map.
    @ViewBuilder private func icon(_ state: String) -> some View {
        switch state {
        case "loading":
            ProgressView().controlSize(.mini)
                .tint(Color(hex: appearance.fontColor) ?? .primary)
        case "partial":
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
        case "ready":
            Image(systemName: "checkmark.seal").foregroundStyle(PortalPrimary())
        case "offline":
            Image(systemName: "wifi.slash").foregroundStyle(.secondary)
        default:
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
        }
    }

    /// "Refining terrain · 87% of loaded tile positions · USGS 3DEP + WA DNR"
    /// reads as a title with its coverage, and the sources beneath.
    static func parts(of text: String) -> (title: String, detail: String) {
        let pieces = text.components(separatedBy: " · ")
        guard let index = pieces.firstIndex(where: { $0.contains("% of loaded tile positions") }) else {
            return (pieces.first ?? text, pieces.dropFirst().joined(separator: " · "))
        }
        let coverage = pieces[index].components(separatedBy: " ").first ?? ""
        let title = (pieces[..<index] + [coverage]).joined(separator: " · ")
        return (title, pieces[(index + 1)...].joined(separator: " · "))
    }
}

/// A selected location exposes a collapsible stack of map actions. With no
/// selection, the single trailing control locates the user.
struct SearchCapsule: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @Binding var actionsExpanded: Bool
    let maxActionHeight: CGFloat
    @Namespace private var glass

    var body: some View {
        GlassEffectContainer(spacing: 10) {
          VStack(alignment: .trailing, spacing: 10) {
            if shell.hasLocation && actionsExpanded {
                locationActions
                    .padding(.trailing, (MapControlSize.search - MapControlSize.imagery) / 2)
                    .transition(reducedMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
            HStack(spacing: 10) {
              HStack(spacing: 0) {
                Button { shell.openSearch() } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: MapControlSize.icon, weight: .medium))
                            .foregroundStyle(.secondary)
                        if shell.search.label.isEmpty {
                            Text("Search places, layers…").foregroundStyle(.secondary)
                        } else {
                            Text(shell.search.label).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if let route = shell.path.last { RouteGlyph(key: route) }
                    }
                    .portalFont(.callout)
                    .padding(.horizontal, 16)
                    .frame(height: MapControlSize.search)
                    .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(shell.search.label.isEmpty ? "Search places and layers" : "Search, \(shell.search.label)")
                .accessibilityHint("Search places and layers")
                if shell.search.canClear {
                    Button { shell.clearLocation() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 44, height: MapControlSize.search)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear the search and selected location")
                }
              }
              .menuGlass(in: .capsule)
              .glassEffectID("search", in: glass)

                Button {
                    if shell.hasLocation { actionsExpanded.toggle() }
                    else { shell.locate() }
                } label: {
                    Image(systemName: shell.hasLocation ? (actionsExpanded ? "chevron.down" : "chevron.up") : "location")
                        .contentTransition(reducedMotion ? .identity : .symbolEffect(.replace))
                        .font(.system(size: MapControlSize.icon, weight: .medium))
                        .foregroundStyle(PortalPrimary())
                        .frame(width: MapControlSize.search, height: MapControlSize.search)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .menuGlass(in: .circle)
                .glassEffectID("location-toggle", in: glass)
                .accessibilityLabel(shell.hasLocation ? (actionsExpanded ? "Hide location actions" : "Show location actions") : "Use my current location")
                .accessibilityValue(shell.hasLocation ? (actionsExpanded ? "Expanded" : "Collapsed") : "")
            }
            .gesture(DragGesture(minimumDistance: 12).onEnded { value in
                if value.translation.height < -24 { shell.openSheet(.medium) }
            })
          }
          .animation(reducedMotion ? nil : .spring(duration: 0.35, bounce: 0.2), value: shell.hasLocation)
          .animation(reducedMotion ? nil : .spring(duration: 0.35, bounce: 0.2), value: actionsExpanded)
        }
        .onChange(of: shell.hasLocation) { _, selected in if !selected { actionsExpanded = false } }
        .onDisappear { actionsExpanded = false }
    }

    @ViewBuilder private var locationActions: some View {
        if maxActionHeight < 314 {
            ScrollView { actionButtons.padding(.vertical, 2) }
                .frame(width: MapControlSize.imagery + 4, height: maxActionHeight)
        } else {
            actionButtons
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 10) {
            LocationShareButton().glassEffectID("share", in: glass)
            locationAction("Open coordinates in Google Maps", "map", id: "maps") {
                if let url = URL(string: shell.search.mapsURL) { openURL(url) }
            }
            .disabled(shell.search.mapsURL.isEmpty)
            locationAction("Open coordinates in Google Earth", "globe", id: "earth") {
                if let url = URL(string: shell.search.earthURL) { openURL(url) }
            }
            .disabled(shell.search.earthURL.isEmpty)
            locationAction("Copy coordinates", "doc.on.doc", id: "copy") { shell.copyCoordinates() }
            BestImageryButton().glassEffectID("imagery", in: glass)
            locationAction("Go to selected location", "arrow.right", id: "go") { shell.centerSelectedLocation() }
                .accessibilityHint("Centers the selected location without searching satellite imagery")
        }
    }

    private func locationAction(_ title: String, _ symbol: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(PortalPrimary())
                .frame(width: MapControlSize.imagery, height: MapControlSize.imagery)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .menuGlass(in: .circle)
        .glassEffectID(id, in: glass)
        .accessibilityLabel(title)
    }
}

/// The same full-state share action is available while a point-cloud view
/// owns the canvas and its normal map search controls are hidden.
struct LocationShareButton: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.portalAppearance) private var appearance

    var body: some View {
        Button { shell.shareLocation() } label: {
            ZStack {
                if shell.shareBusy {
                    ProgressView().controlSize(.small)
                        .tint(Color(hex: appearance.fontColor) ?? .primary)
                } else {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(PortalPrimary())
                }
            }
            .frame(width: MapControlSize.imagery, height: MapControlSize.imagery)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(shell.shareBusy)
        .menuGlass(in: .circle)
        .accessibilityLabel(shell.shareBusy ? "Preparing shared map view" : "Share location and map layers")
    }
}

/// For a selected place: center it, search imagery there and apply
/// the page's Best photo, the scene its Best available summary recommends.
/// Auto-fill surroundings, when on, then fills the view around it.
struct BestImageryButton: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        Button { shell.applyBestImagery() } label: {
            ZStack {
                if shell.imageryBusy {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: Symbols.route("satellite"))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(PortalPrimary())
                }
            }
            .frame(width: MapControlSize.imagery, height: MapControlSize.imagery)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(shell.imageryBusy)
        .menuGlass(in: .circle)
        .accessibilityLabel(shell.imageryBusy ? "Finding the best satellite image" : "Apply the best satellite image here")
        .accessibilityHint("Searches imagery at the selected place and shows the best clear photo")
    }
}

/// Short-lived notices from the page: export progress and location errors.
struct Toasts: View {
    @Environment(ShellModel.self) private var shell
    @State private var shownError: String?
    @State private var hideTask: Task<Void, Never>?
    @State private var shownNotice: ShellNotice?
    @State private var noticeTask: Task<Void, Never>?

    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: 8) {
                if let snapshot = shell.status.snapshot {
                    toast(snapshot, symbol: "camera", tint: .secondary)
                }
                if let notice = shownNotice {
                    toast(notice.text, symbol: notice.applied ? Symbols.route("satellite") : "info.circle", tint: .secondary)
                }
                if let error = shownError {
                    toast(error, symbol: "exclamationmark.triangle", tint: .orange)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, shell.activeSheet == nil ? 70 + (shell.hasLocation ? MapControlSize.imagery + 10 : 0) : 12)
        }
        .animation(.spring(duration: 0.35), value: shell.status.snapshot)
        .animation(.spring(duration: 0.35), value: shownError)
        .animation(.spring(duration: 0.35), value: shownNotice)
        .onChange(of: shell.notice) { _, notice in
            guard let notice else { return }
            AccessibilityNotification.Announcement(notice.text).post()
            shownNotice = notice
            noticeTask?.cancel()
            noticeTask = Task {
                try? await Task.sleep(for: .seconds(4))
                guard !Task.isCancelled else { return }
                shownNotice = nil
            }
        }
        .onChange(of: shell.status.message) { _, message in
            guard let message, message.error == true, !message.text.isEmpty else { return }
            AccessibilityNotification.Announcement(message.text).post()
            guard shell.activeSheet == nil else { return }
            shownError = message.text
            hideTask?.cancel()
            hideTask = Task {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { return }
                shownError = nil
            }
        }
        .allowsHitTesting(false)
    }

    private func toast(_ text: String, symbol: String, tint: Color) -> some View {
        Label {
            Text(text).lineLimit(3)
        } icon: {
            Image(systemName: symbol).foregroundStyle(tint)
        }
        .portalFont(.footnote)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .chromeGlass(in: .capsule, interactive: false)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Shown until the map engine is ready, and again while it restores itself
/// after iOS ends its process.
struct LaunchCover: View {
    var restoring = false

    var body: some View {
        ZStack {
            Color("CanvasBackground").ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "mountain.2")
                    .font(.system(size: 26))
                    .foregroundStyle(.secondary)
                    .symbolEffect(.pulse, options: .repeating)
                VStack(spacing: 2) {
                    Text("Clear Skies").portalFont(.headline)
                    Text(restoring ? "Restoring your map…" : "Loading your map and tools…")
                        .portalFont(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 22)
            .chromeGlass(in: .rect(cornerRadius: 22), interactive: false)
        }
        .transition(.opacity)
    }
}

/// One system Liquid Glass treatment for the dock and floating menus.
struct ChromeGlass<S: Shape>: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let shape: S
    var interactive = true

    func body(content: Content) -> some View {
        let glass: Glass = scheme == .dark ? .regular.tint(Color(white: 0.16).opacity(0.45)) : .regular
        content.glassEffect(interactive ? glass.interactive() : glass, in: shape)
    }
}

struct MenuGlass<S: Shape>: ViewModifier {
    @Environment(\.portalSheetSurface) private var onSheet
    let shape: S

    func body(content: Content) -> some View {
        if onSheet {
            // The parent already supplies regular glass. Clear system glass
            // preserves its color instead of adding a second dark scrim.
            content.glassEffect(.clear.interactive(), in: shape)
        } else {
            content.modifier(ChromeGlass(shape: shape))
        }
    }
}

/// Use the controls' glass for the sheet as well, at every detent.
struct SheetGlass: View {
    var body: some View {
        Rectangle()
            .fill(.clear)
            .chromeGlass(in: .rect, interactive: false)
            .ignoresSafeArea(.container)
    }
}

extension View {
    func chromeGlass<S: Shape>(in shape: S, interactive: Bool = true) -> some View {
        modifier(ChromeGlass(shape: shape, interactive: interactive))
    }

    func menuGlass<S: Shape>(in shape: S) -> some View {
        modifier(MenuGlass(shape: shape))
    }
}
