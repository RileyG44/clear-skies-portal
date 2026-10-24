import SwiftUI

/// Everything drawn over the map: the map tools, the terrain status, and the
/// search capsule the sheet collapses into.
struct MapChrome: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        ZStack {
            VStack(alignment: .trailing, spacing: 0) {
                HStack(alignment: .top, spacing: 10) {
                    TerrainStatusCapsule()
                    Spacer(minLength: 0)
                    MapTools()
                }
                .padding(.horizontal, 12)
                .padding(.top, 6)
                Spacer(minLength: 0)
            }
            VStack {
                Spacer()
                if shell.activeSheet == nil, !shell.mapBusy {
                    SearchCapsule()
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

/// The web dock's tools, in the web's own order, as one Liquid Glass column.
struct MapTools: View {
    @Environment(ShellModel.self) private var shell
    @Namespace private var glass

    var body: some View {
        let tools = shell.dock.filter { $0.hidden != true }
        GlassEffectContainer(spacing: 8) {
            VStack(spacing: 0) {
                ForEach(tools) { tool in
                    ToolButton(tool: tool)
                        .glassEffectID(tool.id, in: glass)
                    if tool.id != tools.last?.id {
                        Divider().frame(width: 22).opacity(0.5)
                    }
                }
            }
            .chromeGlass(in: .capsule)
        }
        .animation(.spring(duration: 0.35, bounce: 0.2), value: tools.map(\.id))
    }
}

struct ToolButton: View {
    @Environment(ShellModel.self) private var shell
    let tool: DockTool

    var body: some View {
        if tool.tool == "mapMode" {
            Menu {
                Section("Map view") {
                    modeButton("2d", "2D map", "Flat map with every layer", "map")
                    modeButton("3d", "3D terrain", "Tilt and fly over the relief", "mountain.2")
                    modeButton("points", "Point cloud", "LiDAR returns in 3D", "circle.grid.3x3")
                }
            } label: {
                glyph(Symbols.tool(tool.tool, mode: shell.map.mode))
            }
            .menuOrder(.fixed)
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityLabel(tool.title)
        } else {
            Button { shell.tool(tool) } label: { glyph(Symbols.tool(tool.tool, mode: shell.map.mode)) }
                .buttonStyle(.plain)
                .disabled(tool.disabled == true)
                .accessibilityLabel(tool.title)
                .accessibilityAddTraits(tool.pressed == true ? .isSelected : [])
        }
    }

    private func modeButton(_ mode: String, _ title: String, _ detail: String, _ symbol: String) -> some View {
        Button { shell.setMode(mode) } label: {
            Label {
                Text(title)
                Text(detail)
            } icon: {
                Image(systemName: shell.map.mode == mode ? "checkmark" : symbol)
            }
        }
    }

    private func glyph(_ symbol: String) -> some View {
        let panel = ShellModel.toolPanels[tool.tool]
        let active = tool.pressed == true || tool.expanded == true || (panel != nil && shell.presentedPanel == panel)
        return Image(systemName: symbol)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(active ? AnyShapeStyle(.tint) : AnyShapeStyle(PortalPrimary()))
            .rotationEffect(.degrees(tool.tool == "bearing" ? -shell.map.bearing : 0))
            .frame(width: 44, height: 44)
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
/// Ready folds away to a small seal; tap it for the full line.
struct TerrainStatusCapsule: View {
    @Environment(ShellModel.self) private var shell
    @State private var folded = false
    @State private var foldTask: Task<Void, Never>?

    var body: some View {
        if let terrain = shell.status.terrain, !terrain.text.isEmpty {
            let parts = Self.parts(of: terrain.text)
            Button {
                withAnimation(.snappy) { folded.toggle() }
                scheduleFold(terrain.state)
            } label: {
                HStack(spacing: 8) {
                    icon(terrain.state)
                        .portalFont(.footnote)
                    if !folded {
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
                .padding(.horizontal, folded ? 10 : 12)
                .padding(.vertical, 8)
                .frame(maxWidth: folded ? nil : 250, alignment: .leading)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .chromeGlass(in: .capsule)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(terrain.text)
            .onChange(of: terrain.state, initial: true) { _, state in
                if state != "ready", folded { withAnimation(.snappy) { folded = false } }
                scheduleFold(state)
            }
        }
    }

    private func scheduleFold(_ state: String) {
        foldTask?.cancel()
        guard state == "ready", !folded else { return }
        foldTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            withAnimation(.snappy) { folded = true }
        }
    }

    @ViewBuilder private func icon(_ state: String) -> some View {
        switch state {
        case "loading":
            ProgressView().controlSize(.mini)
        case "partial":
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
        case "ready":
            Image(systemName: "checkmark.seal").foregroundStyle(.green)
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

/// The collapsed sheet: a search capsule and a locate button floating over
/// the map, as the web's phone layout and the iOS 26 Maps bar do.
struct SearchCapsule: View {
    @Environment(ShellModel.self) private var shell
    @Namespace private var glass

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                Button { shell.openSheet(.medium) } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").portalFont(.footnote, weight: .medium).foregroundStyle(.secondary)
                        if shell.search.label.isEmpty {
                            Text("Search places, layers…").foregroundStyle(.secondary)
                        } else {
                            Text(shell.search.label).foregroundStyle(PortalPrimary()).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if let route = shell.path.last { RouteGlyph(key: route) }
                    }
                    .portalFont(.subheadline)
                    .padding(.horizontal, 16)
                    .frame(height: 46)
                    .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .chromeGlass(in: .capsule)
                .glassEffectID("search", in: glass)
                .accessibilityLabel(shell.search.label.isEmpty ? "Search places and layers" : "Search, \(shell.search.label)")
                .accessibilityHint(shell.path.last.map { "Returns to \(shell.title(for: $0))" } ?? "")

                Button { shell.locate() } label: {
                    Image(systemName: "location")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(PortalPrimary())
                        .frame(width: 46, height: 46)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .chromeGlass(in: .circle)
                .glassEffectID("locate", in: glass)
                .accessibilityLabel("Use my current location")
            }
        }
        .gesture(DragGesture(minimumDistance: 12).onEnded { value in
            if value.translation.height < -24 { shell.openSheet(.medium) }
        })
    }
}

/// Short-lived notices from the page: export progress and location errors.
struct Toasts: View {
    @Environment(ShellModel.self) private var shell
    @State private var shownError: String?
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: 8) {
                if let snapshot = shell.status.snapshot {
                    toast(snapshot, symbol: "camera", tint: .secondary)
                }
                if let error = shownError {
                    toast(error, symbol: "exclamationmark.triangle", tint: .orange)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, shell.activeSheet == nil ? 70 : 12)
        }
        .animation(.spring(duration: 0.35), value: shell.status.snapshot)
        .animation(.spring(duration: 0.35), value: shownError)
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

/// Liquid Glass for the app's own chrome. In dark mode it carries a dark
/// tint, so the tools and sheet stay calm and legible over a bright map.
struct ChromeGlass<S: Shape>: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let shape: S
    var interactive = true

    func body(content: Content) -> some View {
        let glass: Glass = scheme == .dark ? .regular.tint(ChromeTint.dark) : .regular
        content.glassEffect(interactive ? glass.interactive() : glass, in: shape)
    }
}

/// The sheet's background: the map tools' glass, dark-tinted in dark mode,
/// at every height.
struct SheetGlass: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Rectangle()
            .fill(.clear)
            .glassEffect(scheme == .dark ? .regular.tint(ChromeTint.dark) : .regular, in: .rect)
            .ignoresSafeArea()
    }
}

/// One dark tint for every glass surface the app draws in dark mode, the
/// sheet included.
enum ChromeTint {
    static let dark = Color.black.opacity(0.4)
}

extension View {
    func chromeGlass<S: Shape>(in shape: S, interactive: Bool = true) -> some View {
        modifier(ChromeGlass(shape: shape, interactive: interactive))
    }
}
