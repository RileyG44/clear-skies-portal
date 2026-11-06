import SwiftUI
import os

/// The native chrome's state, mirrored from the web client (native-shell.js),
/// and the commands that act on the web's own controls.
///
/// Every value shown here comes from the page. Native views never decide what
/// a layer, source or analysis is; they show what the web reports and send
/// back what a person did, the way a click on the web control would.
@MainActor @Observable
final class ShellModel {
    // Mirrored from the page.
    var groups: [RouteGroup] = []
    var route = ""
    var counts: [String: String] = [:]
    var search = SearchState()
    var map = MapState()
    var dock: [DockTool] = []
    var status = StatusState()
    var panelOpen: String?
    /// The sheet's medium height: how much of the map it covers there.
    var mediumSheetHeight: CGFloat = 0
    /// The open sheet's top edge in the "portal-map" coordinate space.
    var sheetTop: CGFloat?
    /// The open sheet's horizontal extent in the "portal-map" coordinate space.
    var sheetSpan: ClosedRange<CGFloat>?
    /// With map info open, the raised menu stops below this "portal-map"
    /// y so the tile's compact layout fits above it.
    var mapInfoReserve: CGFloat = 0
    var page: ShellPage?
    var panel: ShellPanel?
    var connected = false
    var images: [String: String] = [:]
    var appearance = NativeAppearance()
    var menuLayoutRevision = 0
    /// A dock action that would end a hidden freeform draft waits for an
    /// explicit discard, just like changing tools inside the markup pane.
    struct MarkupExit: Identifiable {
        let id = UUID()
        let points: Int
        let perform: () -> Void
    }
    var markupExit: MarkupExit?

    // Native presentation. One sheet at a time: the tool sheet, or a map
    // tool's pop-up. Changing it swaps one sheet for the other.
    enum ActiveSheet: Hashable, Identifiable {
        case tools
        case panel(String)
        var id: String { if case .panel(let id) = self { "panel:\(id)" } else { "tools" } }
    }
    var activeSheet: ActiveSheet? {
        didSet {
            if case .panel(let id)? = oldValue, activeSheet != oldValue {
                panel = nil
                send("closePanel", ["id": id])
            }
            syncView()
        }
    }
    var detent: PresentationDetent = .medium { didSet { syncView() } }
    var path: [String] = []
    var query = ""
    var suggestions: [PlaceSuggestion] = []
    var routeMatches: [RouteMatch] = []
    var searching = false
    var suggestionNote: String?
    /// Bumped by actions that deserve a haptic (route opened, tool toggled).
    var feedback = 0
    /// True while the map's imagery button waits for its search and pick.
    var imageryBusy = false
    var shareBusy = false
    /// A short confirmation shown over the map, such as the scene applied.
    var notice: ShellNotice?

    @ObservationIgnored weak var backend: (any ShellBackend)?
    @ObservationIgnored private var suggestTask: Task<Void, Never>?
    @ObservationIgnored private var lastView = ""
    @ObservationIgnored private let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "shell")
    @ObservationIgnored private let decoder = JSONDecoder()

    init() {
        // Cache only the existing selected UI theme, so the first native frame
        // already agrees with the web preference that will be published next.
        map.theme = UserDefaults.standard.string(forKey: MapCanvasColor.preferenceKey) ?? ""
    }

    var sheetPresented: Bool { activeSheet == .tools }
    var presentedPanel: String? { if case .panel(let id)? = activeSheet { id } else { nil } }
    /// The page the sheet is showing, if any.
    var visibleRoute: String? { sheetPresented ? path.last : nil }
    /// Modes whose own controls take the bottom of the screen.
    var mapBusy: Bool { map.pointCloud || map.selecting || map.drawing }
    /// A place is committed on the map (a tapped point or a found place).
    var hasLocation: Bool { search.lat != nil && search.lng != nil }
    /// The search field's Go button can act: text to look up, or a place
    /// already selected on the map whose imagery has not been loaded yet.
    var canLoadImagery: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasLocation
    }

    // MARK: - Updates from the page

    func apply(json: String) {
        let update: ShellUpdate
        do {
            update = try decoder.decode(ShellUpdate.self, from: Data(json.utf8))
        } catch {
            log.error("shell update could not be read: \(String(describing: error), privacy: .public)")
            return
        }
        if let images = update.images { self.images.merge(images) { _, next in next } }
        if let keys = update.imageKeys {
            let keep = Set(keys)
            images = images.filter { keep.contains($0.key) }
        }
        if let appearance = update.appearance { self.appearance = appearance }
        if update.ready == true {
            connected = true
            lastView = ""
            if let route = path.last, sheetPresented { open(route: route) } else { syncView() }
            #if DEBUG
            openDebugPage()
            #endif
        }
        if let groups = update.groups { self.groups = groups }
        if let route = update.route { routeChanged(route) }
        if let counts = update.counts { self.counts = counts }
        if let search = update.search {
            if search.version != self.search.version, !query.isEmpty {
                // A new location was committed from the field: show it.
                query = ""
                clearSuggestions()
            }
            self.search = search
        }
        if let map = update.map { applyMap(map) }
        if let dock = update.dock { self.dock = dock }
        if let status = update.status { self.status = status }
        if let panelOpen = update.panelOpen {
            self.panelOpen = panelOpen
            // Draw from a layer page and the dock share the same native pane.
            if let panelOpen, (panelOpen == "mkBar" || backend is NativeShellBackend), presentedPanel != panelOpen {
                detent = .medium
                #if DEBUG
                // `-cspDebugDetent large` also applies to a scripted Draw.
                if UserDefaults.standard.string(forKey: "cspDebugDetent") == "large" { detent = .expanded }
                #endif
                activeSheet = .panel(panelOpen)
            }
        }
        if update.resetMenuLayout == true {
            SectionFolds.resetSaved()
            menuLayoutRevision += 1
        }
        if let page = update.page { self.page = page }
        if let panel = update.panel {
            self.panel = panel
            // The web closed its pop-up (Capture finished, Connect succeeded).
            if panel == nil, presentedPanel != nil, panelOpen == nil { activeSheet = nil }
        }
        if let route = update.openRoute { show(route: route) }
    }

    /// The web can change page itself, from a row inside a page ("Add
    /// layers", a layer's Edit). The sheet follows, with a way back.
    /// The page the app last asked for, until the page reports it. A report
    /// of another page meanwhile was published before the request arrived
    /// (at launch, the page's restored page) and must not move the sheet.
    private var requested: (route: String, at: Date)?

    private func routeChanged(_ next: String) {
        if let requested {
            guard next == requested.route || Date().timeIntervalSince(requested.at) > 2 else { return }
            self.requested = nil
        }
        let previous = route
        route = next
        guard previous != next, sheetPresented, let shown = path.last, shown != next, !next.isEmpty else { return }
        path.append(next)
    }

    /// Modes that draw their own controls over the map take the screen: the
    /// point-cloud viewer, area selections and the markup tools.
    private func applyMap(_ next: MapState) {
        let wasBusy = mapBusy
        map = next
        if next.theme == "light" || next.theme == "dark" {
            UserDefaults.standard.set(next.theme, forKey: MapCanvasColor.preferenceKey)
            backend?.useMapCanvas(next.theme)
        }
        if mapBusy, !wasBusy, activeSheet != nil, presentedPanel != "mkBar" { activeSheet = nil }
    }

    /// Tells the page what the app shows, so it describes only that.
    func syncView() {
        let sheet = activeSheet == nil ? "closed" : (detent == .expanded ? "large" : "medium")
        let page = visibleRoute
        let key = "\(sheet)|\(page ?? "")|\(presentedPanel ?? "")"
        guard key != lastView, connected else { return }
        lastView = key
        send("setView",
             ["sheet": sheet, "page": page ?? NSNull(), "panel": presentedPanel ?? NSNull()])
    }

    /// The page's process ended; everything mirrored from it is stale.
    func reset() {
        connected = false
        images = [:]
        lastView = ""
        page = nil
        panel = nil
        panelOpen = nil
        if presentedPanel != nil { activeSheet = nil }
    }

    // MARK: - Navigation

    func openSheet(_ detent: PresentationDetent = .medium) {
        self.detent = detent
        if activeSheet != .tools { activeSheet = .tools }
    }

    func show(route: String) {
        guard !route.isEmpty else { return }
        openSheet(detent == .expanded ? .expanded : .medium)
        if path.last != route { path = [route] }
        open(route: route)
    }

    /// Called when the navigation path changes, by a push, a back swipe or show(route:).
    func pathChanged() {
        if let route = visibleRoute { open(route: route) } else { syncView() }
    }

    private func open(route: String) {
        if page?.route != route { page = nil }
        let sheet = activeSheet == nil ? "closed" : (detent == .expanded ? "large" : "medium")
        send("open",
             ["route": route, "sheet": sheet, "panel": presentedPanel ?? NSNull()])
        lastView = "\(sheet)|\(route)|\(presentedPanel ?? "")"
        requested = (route, Date())
        self.route = route
        feedback += 1
    }

    #if DEBUG
    /// Verification hook for Debug builds only, beside `-cspDebugScript`:
    /// `-cspDebugPage <route|home>` shows that page in the sheet once the page
    /// is ready, `-cspDebugDetent large` raises the sheet, and ItemList reads
    /// `-cspDebugSection <title>` to scroll to a section. A page can then be
    /// captured without touching the screen.
    private func openDebugPage() {
        let defaults = UserDefaults.standard
        let detent: PresentationDetent = defaults.string(forKey: "cspDebugDetent") == "large" ? .expanded : .medium
        if let panel = defaults.string(forKey: "cspDebugPanel"), Self.toolPanels.values.contains(panel) {
            send("toolForPanel", ["panel": panel])
            self.detent = detent
            activeSheet = .panel(panel)
            return
        }
        guard let route = defaults.string(forKey: "cspDebugPage"), !route.isEmpty else { return }
        openSheet(detent)
        if route != "home" { show(route: route) }
    }
    #endif

    func title(for route: String) -> String {
        groups.lazy.flatMap(\.routes).first { $0.key == route }?.title ?? ""
    }

    func info(for route: String) -> RouteInfo? {
        groups.lazy.flatMap(\.routes).first { $0.key == route }
    }

    // MARK: - Acting on web controls

    enum Op: String {
        case click, toggle, input, commit, select, open, focus, rampAdd, rampMove, key, submit, enter, pick
    }

    func act(_ ref: String?, _ op: Op = .click, _ value: Any? = nil) {
        guard let ref else { return }
        if visibleRoute == "export", ref == "#snapshotCapture" || ref == "#snapshotSelect" {
            activeSheet = nil
        }
        send("act", ["ref": ref, "op": op.rawValue, "value": value ?? NSNull()])
    }

    /// Map tools whose web pop-up the app presents natively.
    static let toolPanels = ["draw": "mkBar", "snapshot": "snapshotPanel", "terrain-source": "terrainSourcePanel", "server": "serverPanel", "scene": "ctl"]

    /// Opens a map tool's pop-up natively (Export, Layers, the engine, the
    /// displayed scene), or presses a tool that has no pop-up.
    func tool(_ tool: DockTool) {
        guard tool.tool == "draw" || allowMarkupExit({ self.performTool(tool) }) else { return }
        performTool(tool)
    }

    private func performTool(_ tool: DockTool) {
        feedback += 1
        if let panel = Self.toolPanels[tool.tool] {
            if presentedPanel == panel { activeSheet = nil; return }
            if panelOpen != panel { send("tool", ["id": tool.id]) }
            // With no editable layer, Draw opens the layer creation page.
            // Wait for the real markup panel's state before presenting it.
            if panel == "mkBar" { return }
            detent = .medium
            activeSheet = .panel(panel)
        } else {
            send("tool", ["id": tool.id])
        }
    }

    /// Types a markup size into the web's own field and reports the web's
    /// verdict, so the app's field stays open until the value is accepted.
    func enterValue(_ ref: String, _ value: String, key: String, owner: String) async -> (accepted: Bool, message: String) {
        let result = await evaluate("enterValue",
                                    ["ref": ref, "value": value, "key": key, "owner": owner]) as? [String: Any]
        guard let result else { return (false, "The size could not be set. Try again.") }
        return (result["accepted"] as? Bool == true, result["message"] as? String ?? "")
    }

    /// Selects a listed mark and, once the web confirms it is the selected
    /// mark, lowers the sheet and brings the mark into view above it.
    func selectMark(_ ref: String, fid: String) async -> Bool {
        let result = await evaluate("selectMark",
                                    ["ref": ref, "fid": fid, "inset": Double(mediumSheetHeight)]) as? [String: Any]
        let selected = result?["selected"] as? Bool == true
        if selected { detent = .medium }
        return selected
    }

    /// Lowers the sheet to its medium height and moves the map so the
    /// selected mark shows above it. The mark itself never moves.
    func revealSelectedMark() {
        detent = .medium
        send("revealSelected", ["inset": Double(mediumSheetHeight)])
    }

    /// Shows the markup tools again while drawing continues on the map.
    func showMarkupTools() {
        if let draw = dock.first(where: { $0.tool == "draw" }) { tool(draw) }
    }

    func setMode(_ mode: String) {
        guard mode != map.mode else { return }
        let change = {
            self.feedback += 1
            self.send("setMode", ["mode": mode])
        }
        if allowMarkupExit(change) { change() }
    }

    /// Called before the dock or a map-mode change can cancel an unfinished
    /// shape. No web command is sent when the person chooses Keep drawing.
    private func allowMarkupExit(_ perform: @escaping () -> Void) -> Bool {
        guard let status = map.markup, status.pending == true, (status.points ?? 0) >= 2 else { return true }
        markupExit = MarkupExit(points: status.points ?? 0) {
            // WebKit receives Cancel first, then the requested navigation.
            self.act(status.cancel)
            perform()
        }
        return false
    }

    /// Reuse the web dock's order and persistence, including hidden tools.
    func moveTool(_ id: String, to index: Int) {
        let visible = dock.filter { $0.hidden != true }
        guard let old = visible.firstIndex(where: { $0.id == id }),
              visible.indices.contains(index), old != index,
              let source = dock.firstIndex(where: { $0.id == id }) else { return }
        let target = visible[index].id
        let tool = dock.remove(at: source)
        if let destination = dock.firstIndex(where: { $0.id == target }) {
            dock.insert(tool, at: destination + (index > old ? 1 : 0))
        }
        send("moveTool", ["id": id, "index": index])
        feedback += 1
    }

    // MARK: - Search

    /// The map's search capsule opens the full menu without the keyboard;
    /// tapping the menu's search field then focuses it.
    func openSearch() {
        path = []
        openSheet(.expanded)
    }

    func queryChanged() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        suggestTask?.cancel()
        suggestionNote = nil
        if text.isEmpty { clearSuggestions(); return }
        suggestTask = Task { [weak self] in
            guard let self else { return }
            if let matches = await self.evaluate("routeMatches", ["text": text]) as? [[String: Any]] {
                self.routeMatches = matches.compactMap { entry in
                    guard let route = entry["route"] as? String else { return nil }
                    return RouteMatch(route: route, keyword: entry["keyword"] as? String ?? "")
                }
            }
            // The web search waits the same 260 ms and needs three characters.
            guard text.count >= 3 else { self.suggestions = []; return }
            try? await Task.sleep(for: .milliseconds(260))
            guard !Task.isCancelled else { return }
            self.searching = true
            defer { if !Task.isCancelled { self.searching = false } }
            do {
                let found = try await self.fetchPlaces(text)
                guard !Task.isCancelled, self.query.trimmingCharacters(in: .whitespacesAndNewlines) == text else { return }
                self.suggestions = found
                self.suggestionNote = found.isEmpty ? "No matching suggestions. Search to look up this text." : nil
            } catch {
                guard !Task.isCancelled else { return }
                self.suggestions = []
                self.suggestionNote = "Place search is unavailable. You can still paste coordinates."
            }
        }
    }

    /// Place suggestions from the web client's geocoder, as the web field gets them.
    func fetchPlaces(_ text: String) async throws -> [PlaceSuggestion] {
        let result = try await ask("suggest", ["text": text])
        guard let places = result as? [[String: Any]] else { return [] }
        return places.compactMap { place in
            guard let index = (place["index"] as? NSNumber)?.intValue,
                  let version = (place["version"] as? NSNumber)?.intValue else { return nil }
            return PlaceSuggestion(index: index, version: version, primary: place["primary"] as? String ?? "",
                                   secondary: place["secondary"] as? String ?? "", kind: place["kind"] as? String ?? "")
        }
    }

    /// Looks up text as the Satellite page's field does, without page shortcuts.
    func searchText(_ text: String) {
        send("searchText", ["text": text])
        finishSearch()
    }

    func clearSuggestions() {
        suggestTask?.cancel()
        suggestions = []
        routeMatches = []
        searching = false
        suggestionNote = nil
    }

    func pick(_ place: PlaceSuggestion) {
        send("pick", ["index": place.index, "version": place.version])
        finishSearch()
    }

    func submit() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Task {
            let result = await evaluate("submit", ["text": text]) as? [String: Any]
            if let route = result?["route"] as? String {
                query = ""
                clearSuggestions()
                show(route: route)
            } else {
                finishSearch()
            }
        }
    }

    func searchMapCenter() {
        send("searchMapCenter")
        finishSearch()
    }

    /// The search field's Go button: manually load satellite imagery,
    /// instead of double-tapping the map. Typed text is looked up first
    /// (the web geocodes it and searches); a place already selected on
    /// the map is searched where it is. Either way the Satellite page
    /// opens so its scenes can be picked.
    func loadImagery() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            searchText(text)
            show(route: "satellite")
        } else if hasLocation {
            send("searchSelected")
            clearSuggestions()
            feedback += 1
            show(route: "satellite")
        }
    }

    /// A committed search shows its place on the map with the sheet out of the way.
    private func finishSearch() {
        query = ""
        clearSuggestions()
        feedback += 1
        if detent == .expanded { detent = .medium }
    }

    func clearLocation() {
        query = ""
        clearSuggestions()
        send("clear")
        feedback += 1
    }

    func locate() {
        send("locate")
        feedback += 1
    }

    func shareLocation() {
        guard hasLocation, !shareBusy else { return }
        log.info("Preparing shared map view")
        shareBusy = true
        feedback += 1
        Task {
            defer { shareBusy = false }
            do {
                let result = try await ask("shareURL") as? [String: Any]
                if let message = result?["error"] as? String {
                    throw NSError(domain: "ClearSkiesShare", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
                }
                guard let value = result?["url"] as? String,
                      let url = URL(string: value) else {
                    throw NSError(domain: "Share link could not be created", code: 1)
                }
                guard let backend else {
                    throw NSError(domain: "ClearSkiesShare", code: 4,
                        userInfo: [NSLocalizedDescriptionKey: "The map is not ready yet. Try again."])
                }
                try backend.shareLocation(url)
                log.info("Presented map share sheet")
            } catch {
                log.error("Map sharing failed: \(error.localizedDescription, privacy: .public)")
                notice = ShellNotice(id: (notice?.id ?? 0) + 1,
                    text: "Unable to share this view. " + error.localizedDescription, applied: false)
            }
        }
    }

    func centerSelectedLocation() {
        send("centerSelected")
        feedback += 1
    }

    func copyCoordinates() {
        send("copyCoordinates")
        feedback += 1
    }

    /// Searches imagery at the selected place and applies the web's own
    /// Best photo pick. The page chooses the scene; this only reports it.
    func applyBestImagery() {
        guard !imageryBusy else { return }
        imageryBusy = true
        feedback += 1
        Task {
            let result = await evaluate("bestImagery") as? [String: Any]
            imageryBusy = false
            if let text = result?["message"] as? String, !text.isEmpty {
                notice = ShellNotice(id: (notice?.id ?? 0) + 1, text: text, applied: result?["applied"] as? Bool == true)
            }
        }
    }

    // MARK: - JavaScript

    func send(_ command: String, _ arguments: [String: Any] = [:]) {
        backend?.send(command, arguments)
    }

    func evaluate(_ query: String, _ arguments: [String: Any] = [:]) async -> Any? {
        try? await ask(query, arguments)
    }

    func ask(_ query: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        guard let backend else { return nil }
        return try await backend.ask(query, arguments)
    }
}

extension PresentationDetent {
    /// Keep the sheet floating over the map, including while editing.
    static let expanded = Self.custom(ExpandedDetent.self)
}

struct ExpandedDetent: CustomPresentationDetent {
    static func height(in context: Context) -> CGFloat? {
        context.maxDetentValue * 0.9
    }
}
