import Foundation

/// What native-shell.js reports about the web client. Every field mirrors a
/// live web control or state; the web stays the only source of truth, and the
/// app never derives scientific or loading state on its own.

/// A JSON scalar: a switch's state, a slider's number, a picker's value.
enum ShellValue: Decodable, Hashable {
    case bool(Bool)
    case number(Double)
    case string(String)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) { self = .bool(bool) }
        else if let number = try? container.decode(Double.self) { self = .number(number) }
        else { self = .string(try container.decode(String.self)) }
    }

    var bool: Bool {
        switch self {
        case .bool(let value): value
        case .number(let value): value != 0
        case .string(let value): !value.isEmpty
        }
    }

    var number: Double? {
        switch self {
        case .number(let value): value
        case .string(let value): Double(value)
        case .bool(let value): value ? 1 : 0
        }
    }

    var string: String {
        switch self {
        case .string(let value): value
        case .number(let value): value.formatted(.number.grouping(.never))
        case .bool(let value): value ? "true" : "false"
        }
    }
}

struct RouteGroup: Decodable, Hashable {
    let label: String
    let routes: [RouteInfo]
}

struct RouteInfo: Decodable, Hashable, Identifiable {
    let key: String
    let title: String
    let description: String
    let icon: String
    var id: String { key }
}

struct GradientStop: Decodable, Hashable {
    let color: String
    let opacity: Double?
    let at: Double
}

struct ItemOption: Decodable, Hashable, Identifiable {
    let ref: String?
    let value: String?
    let title: String?
    let icon: String?
    let selected: Bool?
    let disabled: Bool?
    let color: String?
    let src: String?
    let remove: String?
    let stops: [GradientStop]?

    var id: String { ref ?? value ?? title ?? "" }
    var label: String { title ?? value ?? "" }
}

/// A control inside an item (a layer's switch or opacity, a custom color well).
struct SubControl: Decodable, Hashable {
    var ref: String
    var value: ShellValue? = nil
    var disabled: Bool? = nil
    var display: String? = nil
    var title: String? = nil
    var unit: String? = nil
}

struct LayerAction: Decodable, Hashable, Identifiable {
    let ref: String
    let action: String
    let title: String
    let disabled: Bool?
    var id: String { ref }
}

struct SceneTag: Decodable, Hashable {
    let title: String
    let style: String?
}

struct RampHandle: Decodable, Hashable, Identifiable {
    let ref: String
    let at: Double
    let color: String
    let selected: Bool
    var id: String { ref }
}

/// A slider described on its own, for composite controls such as the sun.
struct SliderSpec: Decodable, Hashable {
    let ref: String
    let title: String?
    let value: ShellValue?
    let min: ShellValue?
    let max: ShellValue?
    let step: ShellValue?
    let display: String?
    let disabled: Bool?
}

/// One described piece of a web page. `kind` decides which fields apply; see
/// the describe functions in native-shell.js.
struct ShellItem: Decodable, Hashable {
    var kind: String
    var ref: String? = nil
    var title: String? = nil
    var detail: String? = nil
    var disabled: Bool? = nil
    var value: ShellValue? = nil
    var min: ShellValue? = nil
    var max: ShellValue? = nil
    var step: ShellValue? = nil
    var display: String? = nil
    var placeholder: String? = nil
    var input: String? = nil
    var options: [ItemOption]? = nil
    var style: String? = nil
    var markdown: String? = nil
    var badge: String? = nil
    var color: String? = nil
    var radio: Bool? = nil
    var icon: String? = nil
    var pressed: Bool? = nil
    var expanded: Bool? = nil
    var role: String? = nil
    var href: String? = nil
    var accessibility: String? = nil
    var open: Bool? = nil
    var pane: Bool? = nil
    /// A web section the app shows as a row that opens and closes it,
    /// rather than as a section of the list (the LiDAR page's disclosures).
    var disclosure: Bool? = nil
    var items: [ShellItem]? = nil
    var stops: [GradientStop]? = nil
    var id: String? = nil
    var locked: Bool? = nil
    var toggle: SubControl? = nil
    var opacity: SubControl? = nil
    var edit: SubControl? = nil
    var actions: [LayerAction]? = nil
    var rename: String? = nil
    var active: Bool? = nil
    var confirm: String? = nil
    var buttons: [ShellItem]? = nil
    var tags: [SceneTag]? = nil
    var src: String? = nil
    var selected: Bool? = nil
    var aspect: Double? = nil
    var custom: SubControl? = nil
    var eye: String? = nil
    var visible: Bool? = nil
    var handles: [RampHandle]? = nil
    /// The ramp's color well for its selected stop.
    var well: SubControl? = nil
    var position: String? = nil
    var remove: SubControl? = nil
    var azimuth: SliderSpec? = nil
    var altitude: SliderSpec? = nil
    /// A slider's number field, shown beside it as one row.
    var entry: SubControl? = nil
    /// A number field's unit ("ft").
    var unit: String? = nil
    /// Labels under a gradient, start to end.
    var labels: [String]? = nil

    var isDisabled: Bool { disabled ?? false }
    var text: String { title ?? "" }
}

struct ShellPage: Decodable, Hashable {
    let route: String
    let title: String
    let description: String
    let items: [ShellItem]
}

struct ShellPanel: Decodable, Hashable {
    let id: String
    let title: String
    let state: String?
    let items: [ShellItem]
}

/// A native-only notice; a new id shows it again even with the same text.
struct ShellNotice: Hashable {
    let id: Int
    let text: String
    let applied: Bool
}

struct SearchState: Decodable, Hashable {
    var version = 0
    var label = ""
    var lat: Double?
    var lng: Double?
    var query = ""
    var canCopy = false
    var coordinates = ""
    var mapsURL = ""
    var earthURL = ""
    var canClear = false
}

struct MapState: Decodable, Hashable {
    var mode = "2d"
    var theme = ""
    var pointCloud = false
    var terrain3d = false
    var selecting = false
    var drawing = false
    var bearing: Double = 0
}

struct DockTool: Decodable, Hashable, Identifiable {
    let ref: String
    let id: String
    let tool: String
    let title: String
    let hidden: Bool?
    let disabled: Bool?
    let pressed: Bool?
    let expanded: Bool?
    let dot: String?
}

struct TerrainStatus: Decodable, Hashable {
    let state: String
    let text: String
}

struct MapInfoSwatch: Decodable, Hashable {
    let label: String
    let src: String
}

struct MapInfoKey: Decodable, Hashable {
    let name: String
    let stops: [GradientStop]?
    let labels: [String]
    let swatches: [MapInfoSwatch]
}

struct MapInfoState: Decodable, Hashable {
    let basis: String
    let coordinates: String
    let elevation: String
    let source: String
    let analysis: String
    let terrain: TerrainStatus
    let keys: [MapInfoKey]
}

struct MessageStatus: Decodable, Hashable {
    let kind: String
    let text: String
    let error: Bool?
}

struct EngineStatus: Decodable, Hashable {
    var online = false
    var state = ""
}

struct StatusState: Decodable, Hashable {
    var mapInfo: MapInfoState?
    var terrain: TerrainStatus?
    var message: MessageStatus?
    var snapshot: String?
    var engine = EngineStatus()
}

struct PlaceSuggestion: Hashable, Identifiable {
    let index: Int
    let version: Int
    let primary: String
    let secondary: String
    let kind: String
    var id: String { "\(version):\(index)" }
}

struct RouteMatch: Hashable, Identifiable {
    let route: String
    let keyword: String
    var id: String { route }
}

/// One message from the page: only the parts that changed. A key that is
/// present with null (no pop-up open) differs from an absent key (unchanged),
/// so this decodes by hand.
nonisolated struct NativeAppearance: Decodable, Hashable, Sendable {
    var toggle: String? = nil
    var track: String? = nil
    var button: String? = nil
    var fontColor: String? = nil
    var font: String = "system"
    var textSize: Double = 1
}

struct ShellUpdate: Decodable {
    var appearance: NativeAppearance?
    var images: [String: String]?
    var imageKeys: [String]?
    var groups: [RouteGroup]?
    var ready: Bool?
    var route: String?
    var counts: [String: String]?
    var search: SearchState?
    var map: MapState?
    var dock: [DockTool]?
    var status: StatusState?
    var panelOpen: String??
    var page: ShellPage?
    var panel: ShellPanel??
    var openRoute: String?

    enum Key: String, CodingKey {
        case groups, ready, route, counts, search, map, dock, status, panelOpen, page, panel, openRoute, images, imageKeys, appearance
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Key.self)
        images = try container.decodeIfPresent([String: String].self, forKey: .images)
        imageKeys = try container.decodeIfPresent([String].self, forKey: .imageKeys)
        appearance = try container.decodeIfPresent(NativeAppearance.self, forKey: .appearance)
        groups = try container.decodeIfPresent([RouteGroup].self, forKey: .groups)
        ready = try container.decodeIfPresent(Bool.self, forKey: .ready)
        route = try container.decodeIfPresent(String.self, forKey: .route)
        counts = try container.decodeIfPresent([String: String].self, forKey: .counts)
        search = try container.decodeIfPresent(SearchState.self, forKey: .search)
        map = try container.decodeIfPresent(MapState.self, forKey: .map)
        dock = try container.decodeIfPresent([DockTool].self, forKey: .dock)
        status = try container.decodeIfPresent(StatusState.self, forKey: .status)
        if container.contains(.panelOpen) { panelOpen = .some(try container.decodeIfPresent(String.self, forKey: .panelOpen)) }
        page = try container.decodeIfPresent(ShellPage.self, forKey: .page)
        if container.contains(.panel) { panel = .some(try container.decodeIfPresent(ShellPanel.self, forKey: .panel)) }
        openRoute = try container.decodeIfPresent(String.self, forKey: .openRoute)
    }
}

extension SearchState {
    enum Key: String, CodingKey {
        case version, label, lat, lng, query, canCopy, coordinates, mapsURL, earthURL, canClear
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Key.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 0
        label = try container.decodeIfPresent(String.self, forKey: .label) ?? ""
        lat = try container.decodeIfPresent(Double.self, forKey: .lat)
        lng = try container.decodeIfPresent(Double.self, forKey: .lng)
        query = try container.decodeIfPresent(String.self, forKey: .query) ?? ""
        canCopy = try container.decodeIfPresent(Bool.self, forKey: .canCopy) ?? false
        coordinates = try container.decodeIfPresent(String.self, forKey: .coordinates) ?? ""
        mapsURL = try container.decodeIfPresent(String.self, forKey: .mapsURL) ?? ""
        earthURL = try container.decodeIfPresent(String.self, forKey: .earthURL) ?? ""
        canClear = try container.decodeIfPresent(Bool.self, forKey: .canClear) ?? false
    }
}

extension MapState {
    enum Key: String, CodingKey {
        case mode, theme, pointCloud, terrain3d, selecting, drawing, bearing
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Key.self)
        mode = try container.decodeIfPresent(String.self, forKey: .mode) ?? "2d"
        theme = try container.decodeIfPresent(String.self, forKey: .theme) ?? ""
        pointCloud = try container.decodeIfPresent(Bool.self, forKey: .pointCloud) ?? false
        terrain3d = try container.decodeIfPresent(Bool.self, forKey: .terrain3d) ?? false
        selecting = try container.decodeIfPresent(Bool.self, forKey: .selecting) ?? false
        drawing = try container.decodeIfPresent(Bool.self, forKey: .drawing) ?? false
        bearing = try container.decodeIfPresent(Double.self, forKey: .bearing) ?? 0
    }
}

extension StatusState {
    enum Key: String, CodingKey {
        case mapInfo, terrain, message, snapshot, engine
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Key.self)
        mapInfo = try container.decodeIfPresent(MapInfoState.self, forKey: .mapInfo)
        terrain = try container.decodeIfPresent(TerrainStatus.self, forKey: .terrain)
        message = try container.decodeIfPresent(MessageStatus.self, forKey: .message)
        snapshot = try container.decodeIfPresent(String.self, forKey: .snapshot)
        engine = try container.decodeIfPresent(EngineStatus.self, forKey: .engine) ?? EngineStatus()
    }
}

/// HTML date fields represent a Gregorian calendar day, independent of the
/// device time zone. The same calendar governs parsing, display and emission.
enum HTMLDate {
    static let timeZone = TimeZone(secondsFromGMT: 0)!
    static var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = timeZone
        return value
    }
    private static var formatter: DateFormatter {
        let value = DateFormatter()
        value.calendar = calendar
        value.locale = Locale(identifier: "en_US_POSIX")
        value.timeZone = timeZone
        value.dateFormat = "yyyy-MM-dd"
        value.isLenient = false
        return value
    }
    static func date(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return formatter.date(from: value)
    }
    static func string(_ value: Date) -> String { formatter.string(from: value) }
}
