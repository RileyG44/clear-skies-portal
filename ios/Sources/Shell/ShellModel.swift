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
    var page: ShellPage?
    var panel: ShellPanel?
    var connected = false
    var images: [String: String] = [:]
    var appearance = NativeAppearance()

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
                call("CSPNativeShell.closePanel(id)", ["id": id])
            }
            syncView()
        }
    }
    var detent: PresentationDetent = .medium { didSet { syncView() } }
    var path: [String] = []
    var query = ""
    var searchRequested = false
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

    @ObservationIgnored weak var host: WebHost?
    @ObservationIgnored private var suggestTask: Task<Void, Never>?
    @ObservationIgnored private var lastView = ""
    @ObservationIgnored private let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "shell")
    @ObservationIgnored private let decoder = JSONDecoder()

    init() {
        // Cache only the existing selected UI theme, so the first native frame
        // already agrees with the web preference that will be published next.
        map.theme = UserDefaults.standard.string(forKey: "clearskies.native.theme.v1") ?? ""
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
        if let panelOpen = update.panelOpen { self.panelOpen = panelOpen }
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
            UserDefaults.standard.set(next.theme, forKey: "clearskies.native.theme.v1")
        }
        if mapBusy, !wasBusy, activeSheet != nil { activeSheet = nil }
    }

    /// Tells the page what the app shows, so it describes only that.
    func syncView() {
        let sheet = activeSheet == nil ? "closed" : (detent == .expanded ? "large" : "medium")
        let page = visibleRoute
        let key = "\(sheet)|\(page ?? "")|\(presentedPanel ?? "")"
        guard key != lastView, connected else { return }
        lastView = key
        call("CSPNativeShell.setView({sheet, page, panel})",
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
        call("CSPNativeShell.open(route); CSPNativeShell.setView({sheet, page: route, panel})",
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
            call("const button = document.querySelector('#mapDock [aria-controls=\"' + panel + '\"]'); if (button) CSPNativeShell.tool(button.id)",
                 ["panel": panel])
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
        case click, toggle, input, commit, select, open, focus, rampAdd, rampMove, key, submit
    }

    func act(_ ref: String?, _ op: Op = .click, _ value: Any? = nil) {
        guard let ref else { return }
        call("CSPNativeShell.act(ref, op, value)", ["ref": ref, "op": op.rawValue, "value": value ?? NSNull()])
    }

    /// Map tools whose web pop-up the app presents natively.
    static let toolPanels = ["snapshot": "snapshotPanel", "terrain-source": "terrainSourcePanel", "server": "serverPanel", "scene": "ctl"]

    /// Opens a map tool's pop-up natively (Export, Layers, the engine, the
    /// displayed scene), or presses a tool that has no pop-up.
    func tool(_ tool: DockTool) {
        feedback += 1
        if let panel = Self.toolPanels[tool.tool] {
            if presentedPanel == panel { activeSheet = nil; return }
            if panelOpen != panel { call("CSPNativeShell.tool(id)", ["id": tool.id]) }
            detent = .medium
            activeSheet = .panel(panel)
        } else {
            call("CSPNativeShell.tool(id)", ["id": tool.id])
        }
    }

    func setMode(_ mode: String) {
        feedback += 1
        call("CSPNativeShell.setMode(mode)", ["mode": mode])
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
        call("CSPNativeShell.moveTool(id, index)", ["id": id, "index": index])
        feedback += 1
    }

    // MARK: - Search

    func openSearch() {
        path = []
        searchRequested = true
        openSheet(.expanded)
    }

    func queryChanged() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        suggestTask?.cancel()
        suggestionNote = nil
        if text.isEmpty { clearSuggestions(); return }
        suggestTask = Task { [weak self] in
            guard let self else { return }
            if let matches = await self.evaluate("return CSPNativeShell.routeMatches(text)", ["text": text]) as? [[String: Any]] {
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
        let result = try await evaluateThrowing("return await CSPNativeShell.suggest(text)", ["text": text])
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
        call("CSPNativeShell.searchText(text)", ["text": text])
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
        call("CSPNativeShell.pick(index, version)", ["index": place.index, "version": place.version])
        finishSearch()
    }

    func submit() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Task {
            let result = await evaluate("return CSPNativeShell.submit(text)", ["text": text]) as? [String: Any]
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
        call("CSPNativeShell.searchMapCenter()")
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
            call("CSPNativeShell.searchSelected()")
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
        call("CSPNativeShell.clear()")
        feedback += 1
    }

    func locate() {
        call("CSPNativeShell.locate()")
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
                let result = try await evaluateThrowing("try { return {url: await ClearSkiesPortalBridge.shareURL()} } catch (error) { return {error: error.message} }") as? [String: Any]
                if let message = result?["error"] as? String {
                    throw NSError(domain: "ClearSkiesShare", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
                }
                guard let value = result?["url"] as? String,
                      let url = URL(string: value) else {
                    throw NSError(domain: "Share link could not be created", code: 1)
                }
                guard let host else {
                    throw NSError(domain: "ClearSkiesShare", code: 4,
                        userInfo: [NSLocalizedDescriptionKey: "The map is not ready yet. Try again."])
                }
                try host.shareLocation(url)
                log.info("Presented map share sheet")
            } catch {
                log.error("Map sharing failed: \(error.localizedDescription, privacy: .public)")
                notice = ShellNotice(id: (notice?.id ?? 0) + 1,
                    text: "Unable to share this view. " + error.localizedDescription, applied: false)
            }
        }
    }

    func centerSelectedLocation() {
        call("CSPNativeShell.centerSelected()")
        feedback += 1
    }

    func copyCoordinates() {
        call("CSPNativeShell.copyCoordinates()")
        feedback += 1
    }

    /// Searches imagery at the selected place and applies the web's own
    /// Best photo pick. The page chooses the scene; this only reports it.
    func applyBestImagery() {
        guard !imageryBusy else { return }
        imageryBusy = true
        feedback += 1
        Task {
            let result = await evaluate("return await CSPNativeShell.bestImagery()") as? [String: Any]
            imageryBusy = false
            if let text = result?["message"] as? String, !text.isEmpty {
                notice = ShellNotice(id: (notice?.id ?? 0) + 1, text: text, applied: result?["applied"] as? Bool == true)
            }
        }
    }

    // MARK: - JavaScript

    func call(_ body: String, _ arguments: [String: Any] = [:]) {
        guard let webView = host?.webView else { return }
        webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page) { [log] result in
            if case .failure(let error) = result {
                log.error("shell call failed: \(String(describing: error), privacy: .public)")
            }
        }
    }

    func evaluate(_ body: String, _ arguments: [String: Any] = [:]) async -> Any? {
        try? await evaluateThrowing(body, arguments)
    }

    func evaluateThrowing(_ body: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        guard let webView = host?.webView else { return nil }
        return try await webView.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
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
