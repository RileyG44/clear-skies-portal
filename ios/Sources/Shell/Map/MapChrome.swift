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
                            TerrainStatusCapsule(maxHeight: min(420, max(100, geometry.size.height - MapControlSize.search - 30)), tileWidth: min(260, max(130, geometry.size.width - MapControlSize.tool - 34)))
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

/// One native tile for the shared engine's location, elevation, terrain status
/// and rendered color keys. Its material is the map toolbar's own glass.
struct TerrainStatusCapsule: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var expanded = false
    @State private var contentHeight: CGFloat = 180
    var maxHeight: CGFloat = 420
    var tileWidth: CGFloat = 260

    var body: some View {
        if let info = shell.status.mapInfo {
            // Keep the map anchor fixed while the overlay changes size. This
            // prevents the dock's layout and system glass from recentering it.
            Color.clear
                .frame(width: MapControlSize.status, height: MapControlSize.status)
                .overlay(alignment: .topLeading) {
                    VStack(alignment: .leading, spacing: 0) {
                        Button {
                            withAnimation(reducedMotion ? nil : .snappy(duration: 0.26)) { expanded.toggle() }
                        } label: {
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
                            .frame(width: expanded ? tileWidth : MapControlSize.status, height: MapControlSize.status)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(expanded ? "Hide map info" : "Show map info")
                        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                        if expanded {
                            ScrollView {
                                information(info)
                                    .padding(.horizontal, 12)
                                    .padding(.bottom, 12)
                                    .frame(width: tileWidth, alignment: .leading)
                                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
                            }
                            .frame(width: tileWidth, height: min(contentHeight, max(44, maxHeight - MapControlSize.status)), alignment: .top)
                            .scrollBounceBehavior(.basedOnSize)
                        }
                    }
                    .frame(width: expanded ? tileWidth : MapControlSize.status, alignment: .topLeading)
                    .clipped()
                    .chromeGlass(in: .rect(cornerRadius: expanded ? 18 : 22), interactive: false)
                    .id(expanded)
                    .transition(reducedMotion ? .identity : .opacity.combined(with: .scale(scale: 0.94, anchor: .topLeading)))
                    .onKeyPress(.escape) {
                        withAnimation(reducedMotion ? nil : .snappy(duration: 0.26)) { expanded = false }
                        return .handled
                    }
                }
        }
    }

    private func information(_ info: MapInfoState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
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
            VStack(alignment: .leading, spacing: 2) {
                Text("Terrain").portalFont(.caption2, weight: .semibold)
                Text(info.terrain.text).portalFont(.caption2).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
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
/// after iOS ends its process.
struct LaunchCover: View {
    var restoring = false
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @Environment(\.displayScale) private var displayScale
    @State private var started = Date()

    var body: some View {
        GeometryReader { geometry in
            let still = reducedMotion
            let scale = max(1, floor(min((geometry.size.width - 48) / 240,
                                         (geometry.size.height - 48) / 96, 3) * displayScale)) / displayScale
            TimelineView(.animation(minimumInterval: 1.0 / 24, paused: still)) { timeline in
                let frame = still ? 0 : Int(max(0, timeline.date.timeIntervalSince(started)) * 24) % 192
                Image(uiImage: PixelSatellite.image(frame: frame))
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 240 * scale, height: 96 * scale)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.black.ignoresSafeArea())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(restoring ? "Restoring your map" : "Loading your map and tools")
        .transition(.opacity)
    }
}

/// Pixel-for-pixel port of Riley's centered satellite generator, 2026-10-28.
/// Render at logical resolution, then scale without interpolation.
private enum PixelSatellite {
    private static let stars: [(Int, Int, Double)] = [(162,19,0.7417869892607294),(206,47,0.9424502837770503),(192,44,0.922324996665417),(10,32,0.7759585674357169),(66,44,0.05185325369909766),(43,10,0.3717933555623072),(225,18,0.38075791704476514),(29,39,0.24933071444268662),(190,16,0.408151054974514),(49,27,0.15960421235803823),(207,7,0.13876741839890316),(161,31,0.1266992325502697),(3,3,0.2094563824951179),(58,13,0.8724077654368019),(77,23,0.9614779889500835),(141,46,0.6257301956771277),(49,47,0.19687904392603262),(231,27,0.29878889785386775),(95,29,0.1659560571297456),(40,19,0.06513971337567626),(80,41,0.5861412585033708),(155,46,0.7076761524222557),(19,22,0.35535135729996914),(81,33,0.6964198076411567),(50,33,0.47253834981224785),(48,6,0.25618183594271204),(8,25,0.8448808893881297),(7,38,0.7877383039804342),(96,27,0.5785188290568746),(5,31,0.04672711869894153),(49,42,0.9551798995911663),(53,10,0.7557364124513177),(212,32,0.34438181305301196),(93,36,0.25089395624103406),(121,9,0.5897633712619398),(202,26,0.8596943191875801),(12,30,0.9458001850421838),(26,16,0.34074053550422223),(159,26,0.9180871855333121),(90,20,0.9241976194277907)]
    private static let surface: [Int] = {
        let control = [(0,72),(16,62),(30,74),(46,66),(60,78),(76,64),(92,76),(108,68),
                       (122,80),(138,64),(154,76),(170,62),(186,74),(204,66),(220,78),(240,70)]
        return (0..<240).map { x in
            let i = (0..<control.count-1).first { x <= control[$0+1].0 }!
            let (x0,y0) = control[i], (x1,y1) = control[i+1]
            return Int((Double(y0) + Double(y1-y0) * Double(x-x0) / Double(x1-x0)).rounded(.toNearestOrEven))
        }
    }()
    static func image(frame f: Int) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: 240, height: 96), format: format).image { renderer in
            let c = renderer.cgContext
            c.setShouldAntialias(false)
            c.setFillColor(UIColor.black.cgColor)
            c.fill(CGRect(x: 0, y: 0, width: 240, height: 96))
            let white = UIColor(white: 235.0/255, alpha: 1)
            let gray = UIColor(white: 120.0/255, alpha: 1)
            let dark = UIColor(white: 55.0/255, alpha: 1)
            func point(_ x: Int, _ y: Int, _ color: UIColor) {
                c.setFillColor(color.cgColor)
                c.fill(CGRect(x: x, y: y, width: 1, height: 1))
            }
            func line(_ ax: Int, _ ay: Int, _ bx: Int, _ by: Int, _ visit: (Int, Int, Int) -> Void) {
                var x = ax, y = ay, i = 0
                let dx = abs(bx-x), dy = abs(by-y), sx = x < bx ? 1 : -1, sy = y < by ? 1 : -1
                var error = dx-dy
                while true {
                    visit(x,y,i); i += 1
                    if x == bx && y == by { break }
                    let e = 2*error
                    if e > -dy { error -= dy; x += sx }
                    if e < dx { error += dx; y += sy }
                }
            }
            func solid(_ x: Int, _ y: Int, _ bx: Int, _ by: Int, _ color: UIColor) {
                line(x,y,bx,by) { px,py,_ in point(px,py,color) }
            }
            func rect(_ x: Int, _ y: Int, _ bx: Int, _ by: Int) {
                c.setFillColor(UIColor.black.cgColor)
                c.fill(CGRect(x: x, y: y, width: bx-x+1, height: by-y+1))
                solid(x,y,bx,y,white); solid(bx,y,bx,by,white)
                solid(bx,by,x,by,white); solid(x,by,x,y,white)
            }
            let t = Double(f)/192
            func round(_ v: Double) -> Int { Int(v.rounded(.toNearestOrEven)) }
            for (x,y,phase) in stars {
                let tw = sin(2 * .pi * (2*t+phase))
                if tw > -0.2 { point(x,y,tw > 0.5 ? white : gray) }
            }
            for x in 0..<240 {
                let y = surface[x]
                point(x,y,white)
                for py in stride(from: y+3, to: 96, by: 4) where (x+py*3)%6 == 0 { point(x,py,dark) }
            }
            for (k,x) in [22,66,100,148,180,214].enumerated() {
                let y = surface[x]
                solid(x,y-1,x,y-6,gray)
                if k%2 == 0 { solid(x-2,y-2,x+2,y-2,gray); solid(x-1,y-4,x+1,y-4,gray) }
                else { solid(x-2,y-5,x+2,y-5,gray) }
            }
            let sx = 120, sy = round(26+1.2*sin(2 * .pi * t))
            for (k,o) in [-9,0,9].enumerated() {
                let hx = max(0,min(239,sx+round(Double(o)*1.6+9*sin(2 * .pi * (t+Double(k)/3)))))
                let by = surface[hx]-1
                line(sx+o/3,sy+6,hx,by) { x,y,i in
                    if ((i-f*2+k*2)%6+6)%6 < 3 { point(x,y,white) }
                }
                if (f+k*2)%4 < 2 { point(hx+1,by,white); point(hx-1,by,white); point(hx,by-1,white) }
            }
            for (x,bx) in [(sx-16,sx-7),(sx+7,sx+16)] {
                rect(x,sy-3,bx,sy+3)
                for gx in stride(from: x+3, to: bx, by: 3) { solid(gx,sy-2,gx,sy+2,gray) }
            }
            solid(sx-6,sy,sx-4,sy,white); solid(sx+4,sy,sx+6,sy,white)
            rect(sx-4,sy-4,sx+4,sy+4)
            c.setFillColor(white.cgColor)
            c.fill(CGRect(x: sx-1,y: sy-1,width: 3,height: 3))
            solid(sx,sy-5,sx,sy-8,white); point(sx,sy-9,white)
            solid(sx-1,sy+5,sx+1,sy+5,white)
        }
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
