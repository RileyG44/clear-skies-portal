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
    /// Map info squeezed by an open menu spans the menu's width; the dock
    /// steps aside for it as it does for the raised menu.
    @State private var mapInfoSpansSheet = false
    private var dockHiddenProgress: CGFloat { shell.presentedPanel == "mkBar" ? 1 : toolbarHideProgress }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VStack(alignment: .trailing, spacing: 0) {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 10) {
                            TerrainStatusCapsule(maxHeight: min(420, max(100, geometry.size.height - MapControlSize.search - 30)), tileWidth: min(260, max(130, geometry.size.width - MapControlSize.tool - 34)),
                                                 compactWidth: geometry.size.width - 8, spansSheet: $mapInfoSpansSheet)
                            if shell.map.pointCloud && shell.hasLocation { LocationShareButton() }
                        }
                        Spacer(minLength: 0)
                        // The markup pane has its own tools and a Hide button;
                        // the dock steps aside so the map has room to draw on.
                        let dockHidden = mapInfoSpansSheet ? 1 : dockHiddenProgress
                        MapTools(maxHeight: geometry.size.height - MapControlSize.search - (locationActionsExpanded ? 324 : 0) - 20)
                            .opacity(1 - dockHidden)
                            .scaleEffect(reducedMotion ? 1 : 1 - 0.04 * dockHidden, anchor: .topTrailing)
                            .offset(x: reducedMotion ? 0 : 12 * dockHidden)
                            .allowsHitTesting(dockHidden < 0.99)
                            .accessibilityHidden(dockHidden >= 0.99)
                            .animation(reducedMotion ? nil : .snappy(duration: 0.25), value: shell.presentedPanel == "mkBar")
                            .animation(reducedMotion ? nil : .snappy(duration: 0.25), value: mapInfoSpansSheet)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 6)
                    Spacer(minLength: 0)
                }
                VStack {
                    Spacer()
                    if shell.activeSheet == nil, let markup = shell.map.markup {
                        // Drawing continues with the markup tools hidden.
                        MarkupActiveCapsule(status: markup)
                            .padding(.horizontal, 14)
                            .padding(.bottom, 6)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    } else if shell.activeSheet == nil, !shell.mapBusy {
                        SearchCapsule(actionsExpanded: $locationActionsExpanded, maxActionHeight: max(44, geometry.size.height - MapControlSize.search - 22))
                            .padding(.horizontal, 14)
                            .padding(.bottom, 6)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                Toasts()
            }
            .animation(.spring(duration: 0.4, bounce: 0.18), value: shell.activeSheet == nil && !shell.mapBusy)
            .animation(.spring(duration: 0.4, bounce: 0.18), value: shell.map.markup == nil)
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

/// One native tile for the shared engine's location, elevation, terrain status
/// and rendered color keys. Its material is the map toolbar's own glass.
struct TerrainStatusCapsule: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var expanded = Self.startsExpanded
    @State private var contentHeight: CGFloat = 180
    @State private var origin: CGPoint = .zero
    var maxHeight: CGFloat = 420
    var tileWidth: CGFloat = 260
    /// The menu's width, at which the compact layout is measured.
    var compactWidth: CGFloat = 0
    @Binding var spansSheet: Bool
    @State private var narrowHeight: CGFloat = 0
    @State private var compactHeight: CGFloat = 0
    @State private var moreBelow = false

    /// Debug builds accept `-cspDebugMapInfo open` to verify the open tile.
    private static var startsExpanded: Bool {
        #if DEBUG
        UserDefaults.standard.string(forKey: "cspDebugMapInfo") == "open"
        #else
        false
        #endif
    }

    /// When an open menu leaves too little height for the tile's details,
    /// the tile shares the menu's leading edge and width and switches to a
    /// compact summary of only what reads the map.
    private var sheetSpan: ClosedRange<CGFloat>? {
        guard expanded, shell.activeSheet != nil, let span = shell.sheetSpan,
              span.upperBound - span.lowerBound > tileWidth,
              narrowHeight + MapControlSize.status > heightLimit + 0.5 else { return nil }
        return span
    }
    private var wide: Bool { sheetSpan != nil }
    private var width: CGFloat {
        guard expanded else { return MapControlSize.status }
        guard let span = sheetSpan else { return tileWidth }
        return span.upperBound - span.lowerBound
    }
    private var leadingShift: CGFloat {
        guard let span = sheetSpan else { return 0 }
        return span.lowerBound - origin.x
    }

    /// The compact layout is measured at the open menu's width, or the
    /// screen's when no menu is open yet.
    private var measuredCompactWidth: CGFloat {
        guard let span = shell.sheetSpan else { return compactWidth }
        return span.upperBound - span.lowerBound
    }

    /// Open map info asks the raised menu to stop below its compact layout.
    private var menuReserve: CGFloat {
        expanded && compactHeight > 0 ? origin.y + compactHeight + 8 : 0
    }

    /// The tile's tallest size. With a menu open it ends 8 points above the
    /// menu's top edge, so the menu never covers it; its details scroll. It
    /// is the actual room, which can be less than a control's height.
    private var heightLimit: CGFloat {
        guard shell.activeSheet != nil, let sheetTop = shell.sheetTop else { return maxHeight }
        return min(maxHeight, max(0, sheetTop - origin.y - 8))
    }

    var body: some View {
        if let info = shell.status.mapInfo {
            // Keep the map anchor fixed while the overlay changes size. This
            // prevents the dock's layout and system glass from recentering it.
            Color.clear
                .frame(width: MapControlSize.status, height: MapControlSize.status)
                .onGeometryChange(for: CGPoint.self) { $0.frame(in: .named("portal-map")).origin } action: { origin = $0 }
                .background(alignment: .topLeading) {
                    // Both layouts are measured whichever is showing: the
                    // narrow one decides whether the menu squeezes the tile,
                    // and the compact one is the room the raised menu leaves.
                    if expanded {
                        ZStack(alignment: .topLeading) {
                            information(info)
                                .padding(.horizontal, 12)
                                .padding(.bottom, 12)
                                .frame(width: tileWidth, alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { narrowHeight = $0 }
                            VStack(alignment: .leading, spacing: 0) {
                                compactHeader(info)
                                compactBody(info)
                            }
                            .frame(width: max(tileWidth, measuredCompactWidth), alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { compactHeight = $0 }
                        }
                        .hidden()
                        .accessibilityHidden(true)
                    }
                }
                .onChange(of: wide, initial: true) { spansSheet = wide }
                .onChange(of: menuReserve, initial: true) { shell.mapInfoReserve = menuReserve }
                .onDisappear {
                    spansSheet = false
                    shell.mapInfoReserve = 0
                }
                .overlay(alignment: .topLeading) {
                    Group {
                        if wide { compactTile(info) } else { tile(info) }
                    }
                    .frame(width: width, alignment: .topLeading)
                    .clipped()
                    .chromeGlass(in: .rect(cornerRadius: expanded ? 18 : 22), interactive: false)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height.rounded(.up) } action: { height in
                        // Keep web download progress below the native info tile,
                        // including its expanded and larger-text layouts.
                        shell.call("document.documentElement.style.setProperty('--csp-map-info-height', height + 'px')",
                                   ["height": Double(height)])
                    }
                    .offset(x: leadingShift)
                    .animation(reducedMotion ? nil : .snappy(duration: 0.3), value: wide)
                    .id(expanded)
                    .transition(reducedMotion ? .identity : .opacity.combined(with: .scale(scale: 0.94, anchor: .topLeading)))
                    .onKeyPress(.escape) {
                        withAnimation(reducedMotion ? nil : .snappy(duration: 0.26)) { expanded = false }
                        return .handled
                    }
                }
        }
    }

    private func toggle() {
        withAnimation(reducedMotion ? nil : .snappy(duration: 0.26)) { expanded.toggle() }
    }

    /// The corner button, or a header above the details when expanded.
    private func tile(_ info: MapInfoState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack(spacing: 8) {
                    Image(systemName: "info.circle").font(.system(size: 18))
                    if expanded {
                        Text("Map info").portalFont(.caption, weight: .semibold)
                        Spacer(minLength: 0)
                        Image(systemName: "xmark").font(.system(size: 12))
                    }
                }
                .foregroundStyle(PortalPrimary())
                .padding(.horizontal, expanded ? 12 : 0)
                .frame(width: width, height: MapControlSize.status)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(expanded ? "Hide map info" : "Show map info")
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded {
                details(maxHeight: heightLimit - MapControlSize.status) {
                    information(info)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                }
            }
        }
    }

    /// Squeezed by the menu, the tile keeps only what reads the map: where
    /// it is sampling, the coordinates and elevation, and the active keys.
    /// Sources and a ready terrain status drop out; trouble with terrain
    /// still shows, briefly. The header stays put while the rest scrolls.
    private func compactTile(_ info: MapInfoState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            compactHeader(info)
            details(maxHeight: heightLimit - compactHeaderHeight) { compactBody(info) }
        }
        .overlay(alignment: .topTrailing) {
            Button(action: toggle) {
                Image(systemName: "xmark")
                    .font(.system(size: 12))
                    .foregroundStyle(PortalPrimary())
                    .frame(width: MapControlSize.status, height: MapControlSize.status)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hide map info")
            .accessibilityValue("Expanded")
        }
        .frame(width: width, alignment: .topLeading)
    }

    @State private var compactHeaderHeight: CGFloat = 34

    private func compactHeader(_ info: MapInfoState) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "info.circle").font(.system(size: 13)).accessibilityHidden(true)
            Text(info.basis).portalFont(.caption2, weight: .semibold).foregroundStyle(.secondary)
        }
        .foregroundStyle(PortalPrimary())
        .padding(.horizontal, 12)
        .padding(.trailing, MapControlSize.status - 12)
        .frame(minHeight: 34)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { compactHeaderHeight = $0 }
    }

    private func compactBody(_ info: MapInfoState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) { compactPosition(info) }
                    VStack(alignment: .leading, spacing: 2) { compactPosition(info) }
                }
                if !info.analysis.isEmpty {
                    Text(info.analysis).portalFont(.caption2)
                }
                if let notice = Self.terrainNotice(info.terrain) {
                    Label(notice.text, systemImage: notice.symbol)
                        .portalFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            // The close button's 44-point target reaches 10 points into this row.
            .padding(.trailing, MapControlSize.status - 12)
            .accessibilityElement(children: .combine)
            if info.distance != nil || !info.keys.isEmpty {
                FlowLayout(spacing: 16, lineSpacing: 8) {
                    if let distance = info.distance {
                        CompactDistanceKey(distance: distance)
                    }
                    ForEach(Array(info.keys.enumerated()), id: \.offset) { _, key in
                        CompactInfoKey(key: key)
                    }
                }
                .padding(.top, 8)
            }
        }
        .foregroundStyle(PortalPrimary())
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func compactPosition(_ info: MapInfoState) -> some View {
        Text(info.coordinates).portalFont(.caption, weight: .semibold, digits: true).lineLimit(1)
        // "Elevation ≈ 2,426 ft" reads as "≈ 2,426 ft" beside a mountain.
        let elevation = info.elevation.hasPrefix("Elevation ") ? String(info.elevation.dropFirst("Elevation ".count)) : info.elevation
        Label { Text(elevation).portalFont(.caption, weight: .medium, digits: true).lineLimit(1) } icon: {
            Image(systemName: "mountain.2").font(.system(size: 11))
        }
        .labelStyle(CompactLabelStyle())
        .accessibilityLabel(info.elevation)
    }

    /// A short notice for terrain that needs attention: loading (with its
    /// progress), partial or offline. Ready or deliberately off terrain is
    /// not news, and the full message's sources and coverage are fluff here.
    static func terrainNotice(_ terrain: TerrainStatus) -> (text: String, symbol: String)? {
        switch terrain.state {
        case "loading":
            let progress = terrain.text.firstMatch(of: /\d+%/).map { " · \($0.output)" } ?? ""
            return ("Loading terrain" + progress, "arrow.triangle.2.circlepath")
        case "partial": return ("Some terrain detail unavailable", "exclamationmark.triangle")
        case "offline": return ("Terrain offline", "wifi.slash")
        default: return nil
        }
    }

    /// Details scroll once they are taller than the room above the menu.
    /// While more is below, the bottom edge fades under a chevron.
    private func details<Content: View>(maxHeight: CGFloat, @ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .frame(height: min(contentHeight, max(0, maxHeight)), alignment: .top)
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicatorsFlash(onAppear: true)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.containerSize.height < geometry.contentSize.height - 2
        } action: { _, more in moreBelow = more }
        .mask {
            LinearGradient(stops: [.init(color: .black, location: 0),
                                   .init(color: .black, location: moreBelow ? 0.7 : 1),
                                   .init(color: .black.opacity(moreBelow ? 0.15 : 1), location: 1)],
                           startPoint: .top, endPoint: .bottom)
        }
        .overlay(alignment: .bottomTrailing) {
            if moreBelow {
                Image(systemName: "chevron.compact.down")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PortalPrimary())
                    .padding(.trailing, 16)
                    .padding(.bottom, 3)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .transition(.opacity)
            }
        }
        .animation(reducedMotion ? nil : .easeOut(duration: 0.2), value: moreBelow)
        .animation(reducedMotion ? nil : .snappy(duration: 0.3), value: heightLimit)
    }

    private func information(_ info: MapInfoState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            location(info)
            terrain(info)
            if let distance = info.distance {
                MapDistanceKeyView(distance: distance)
            }
            ForEach(Array(info.keys.enumerated()), id: \.offset) { _, key in
                MapInfoKeyView(key: key)
            }
        }
        .foregroundStyle(PortalPrimary())
        .fixedSize(horizontal: false, vertical: true)
    }

    private func location(_ info: MapInfoState) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(info.basis).portalFont(.caption2).foregroundStyle(.secondary)
            Text(info.coordinates).portalFont(.caption, weight: .medium, digits: true)
            Text(info.elevation).portalFont(.caption, digits: true)
            if !info.source.isEmpty {
                Text(info.source).portalFont(.caption2).foregroundStyle(.secondary)
            }
            if !info.analysis.isEmpty {
                Text(info.analysis).portalFont(.caption)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func terrain(_ info: MapInfoState) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Terrain").portalFont(.caption2, weight: .semibold)
            Text(info.terrain.text).portalFont(.caption2).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) { configuration.icon; configuration.title }
    }
}

/// Lays views out left to right, wrapping onto new lines.
private struct FlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    private func frames(_ width: CGFloat?, _ subviews: Subviews) -> [CGRect] {
        let limit = width ?? .infinity
        var frames: [CGRect] = []
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0 && x + size.width > limit {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return frames
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let union = frames(proposal.width, subviews).reduce(CGRect.null) { $0.union($1) }
        return union.isNull ? .zero : CGSize(width: union.maxX, height: union.maxY)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (frame, subview) in zip(frames(proposal.width ?? bounds.width, subviews), subviews) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                          proposal: ProposedViewSize(frame.size))
        }
    }
}

/// The distance key at half length, still true to scale, so it shares a
/// line with the color keys. The number comes from the web as a value, not
/// parsed from its localized label.
private struct CompactDistanceKey: View {
    let distance: MapDistanceKey

    private var scaled: (label: String, width: CGFloat) {
        let width = CGFloat(max(0, distance.width))
        guard width > 96, let amount = distance.amount, amount > 0, let unit = distance.unit else { return (distance.label, width) }
        return ("\((amount / 2).formatted(.number.precision(.fractionLength(0...2)))) \(unit)", width / 2)
    }

    var body: some View {
        let scaled = scaled
        VStack(alignment: .leading, spacing: 3) {
            Text("Distance").portalFont(.caption2, weight: .semibold)
            HStack(spacing: 6) {
                DistanceScaleBar().frame(width: scaled.width, height: 7)
                Text(scaled.label).portalFont(.caption2, weight: .semibold).lineLimit(1).fixedSize()
            }
            .frame(minHeight: 13)
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Distance scale, \(scaled.label)")
    }
}

/// A color key in the compact tile: its name over its ramp. A numeric range
/// keeps its end values beside the ramp; a cyclic or categorical key (aspect,
/// contours) keeps every label under it. Swatches wrap, three at first, and
/// "+N" shows the rest. Qualifiers after " · " drop out of the visible text.
private struct CompactInfoKey: View {
    let key: MapInfoKey
    @Environment(\.self) private var environment
    @State private var showsAllSwatches = false

    private static func short(_ label: String) -> String {
        label.components(separatedBy: " · ").first ?? label
    }

    /// "Snow depth · inches" reads "Snow depth (inches)"; method notes such
    /// as "Contours · 2 ft base interval · every fifth indexed" drop out.
    private var shortName: String {
        let parts = key.name.components(separatedBy: " · ")
        guard parts.count > 1, let unit = parts.last,
              ["inches", "feet", "degrees", "metres", "meters", "percent"].contains(unit) else { return parts[0] }
        return "\(parts[0]) (\(unit))"
    }

    /// Every label starts with a number: a range whose ends say it all.
    private var isNumericRange: Bool {
        key.labels.count >= 2 && key.labels.allSatisfy { $0.trimmingCharacters(in: .whitespaces).firstMatch(of: /^[−\-+≈<>]?\s*\d/) != nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(shortName).portalFont(.caption2, weight: .semibold).lineLimit(1)
            if let stops = key.stops {
                if key.labels.isEmpty {
                    ramp(stops).frame(width: 64, height: 6).padding(.vertical, 3.5)
                } else if isNumericRange {
                    HStack(spacing: 6) {
                        Text(Self.short(key.labels[0]))
                        ramp(stops).frame(width: 64, height: 6)
                        Text(Self.short(key.labels[key.labels.count - 1]))
                    }
                    .frame(minHeight: 13)
                } else {
                    HStack(spacing: 0) {
                        ForEach(Array(key.labels.enumerated()), id: \.offset) { index, label in
                            if index > 0 { Spacer(minLength: 8) }
                            Text(Self.short(label))
                        }
                    }
                    .frame(minWidth: 96)
                    .padding(.top, 9)
                    .overlay(alignment: .top) { ramp(stops).frame(height: 6) }
                }
            }
            if !key.swatches.isEmpty { swatches }
        }
        .portalFont(.caption2)
        .lineLimit(1)
        .fixedSize(horizontal: key.swatches.isEmpty, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenDescription)
        .accessibilityAction(named: showsAllSwatches ? "Show fewer" : "Show all") { showsAllSwatches.toggle() }
    }

    private func ramp(_ stops: [GradientStop]) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(LinearGradient(gradient: Gradient(stops: stops), startPoint: .leading, endPoint: .trailing))
            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(.primary.opacity(0.25), lineWidth: 0.5))
    }

    private var swatches: some View {
        let hidden = key.swatches.count - 3
        let shown = showsAllSwatches || hidden <= 0 ? key.swatches : Array(key.swatches.prefix(3))
        return FlowLayout(spacing: 8, lineSpacing: 3) {
            ForEach(Array(shown.enumerated()), id: \.offset) { _, swatch in
                HStack(spacing: 3) {
                    ShellImage(src: swatch.src).frame(width: 12, height: 9)
                    Text(swatch.label).lineLimit(2)
                }
            }
            if hidden > 0 {
                Button(showsAllSwatches ? "Less" : "+\(hidden) more") {
                    withAnimation(.snappy(duration: 0.25)) { showsAllSwatches.toggle() }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.tint)
                .padding(.vertical, 6)
                .padding(.horizontal, 4)
                .contentShape(.rect)
                .padding(.vertical, -6)
            }
        }
    }

    /// What the colors mean, for VoiceOver: which end is light or dark, or
    /// every category in order, or every swatch.
    private var spokenDescription: String {
        if !key.swatches.isEmpty {
            return "\(key.name): " + key.swatches.map(\.label).joined(separator: ", ")
        }
        guard let stops = key.stops, let first = stops.first, let last = stops.last else { return key.name }
        if key.labels.isEmpty { return "\(key.name), shaded in this color" }
        if !isNumericRange {
            return "\(key.name), colors from left to right: " + key.labels.joined(separator: ", ")
        }
        let low = key.labels[0], high = key.labels[key.labels.count - 1]
        let lowLight = luminance(first.color), highLight = luminance(last.color)
        if abs(lowLight - highLight) > 0.15 {
            let (lowTone, highTone) = lowLight > highLight ? ("light", "dark") : ("dark", "light")
            return "\(key.name), \(lowTone) colors \(low), \(highTone) colors \(high)"
        }
        return "\(key.name), colors from \(low) to \(high)"
    }

    private func luminance(_ hex: String) -> Double {
        let resolved = (Color(hex: hex) ?? .black).resolve(in: environment)
        return 0.2126 * Double(resolved.linearRed) + 0.7152 * Double(resolved.linearGreen) + 0.0722 * Double(resolved.linearBlue)
    }
}

private struct MapDistanceKeyView: View {
    let distance: MapDistanceKey

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Distance").portalFont(.caption2, weight: .semibold)
            HStack(alignment: .center, spacing: 8) {
                DistanceScaleBar()
                    .frame(width: CGFloat(max(0, distance.width)), height: 8)
                Text(distance.label)
                    .portalFont(.caption2, weight: .semibold)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Distance, \(distance.label)")
    }
}

private struct DistanceScaleBar: View {
    var body: some View {
        Canvas { context, size in
            var path = Path()
            let inset = 0.75
            let bottom = size.height - inset
            let right = max(inset, size.width - inset)
            path.move(to: CGPoint(x: inset, y: bottom))
            path.addLine(to: CGPoint(x: right, y: bottom))
            path.move(to: CGPoint(x: inset, y: 0))
            path.addLine(to: CGPoint(x: inset, y: bottom))
            path.move(to: CGPoint(x: right, y: 0))
            path.addLine(to: CGPoint(x: right, y: bottom))
            context.stroke(path, with: .foreground, lineWidth: 1.5)
        }
        .accessibilityHidden(true)
    }
}

private struct MapInfoKeyView: View {
    let key: MapInfoKey

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(key.name).portalFont(.caption2, weight: .semibold)
            if let stops = key.stops {
                RoundedRectangle(cornerRadius: 2)
                    .fill(LinearGradient(gradient: Gradient(stops: stops), startPoint: .leading, endPoint: .trailing))
                    .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(.primary.opacity(0.25), lineWidth: 0.5))
                    .frame(height: 6)
                HStack(alignment: .top, spacing: 4) {
                    ForEach(Array(key.labels.enumerated()), id: \.offset) { index, label in
                        Text(label).frame(maxWidth: .infinity, alignment: index == 0 ? .leading : index == key.labels.count - 1 ? .trailing : .center)
                    }
                }
                .portalFont(.caption2)
            }
            if !key.swatches.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 3), alignment: .leading, spacing: 4) {
                    ForEach(Array(key.swatches.enumerated()), id: \.offset) { _, swatch in
                        HStack(spacing: 3) {
                            ShellImage(src: swatch.src).frame(width: 12, height: 9).accessibilityHidden(true)
                            Text(swatch.label).portalFont(.caption2)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
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
/// after iOS ends its process. It is the map's own canvas color, matching the
/// launch screen and the page's first frame, so startup has no loading
/// animation and no color change: the map and its controls fade in over it.
struct LaunchCover: View {
    @Environment(ShellModel.self) private var shell
    var restoring = false
    var failure: String?
    var retry: () -> Void = {}

    var body: some View {
        ZStack {
            MapCanvasColor.color(theme: shell.map.theme).ignoresSafeArea()
            if let failure {
                VStack(spacing: 16) {
                    Text(failure).multilineTextAlignment(.center)
                    Button("Reload map", action: retry)
                        .buttonStyle(.borderedProminent)
                        .frame(minHeight: 44)
                }
                .padding(24)
                .frame(maxWidth: 420)
                .accessibilityElement(children: .contain)
            } else {
                Color.clear.accessibilityElement()
                    .accessibilityLabel(restoring ? "Restoring your map" : "Loading your map and tools")
            }
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
