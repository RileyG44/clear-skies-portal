import SwiftUI

/// SF Symbols for the web client's Lucide icon names. Outline glyphs in one
/// quiet color; accent color is kept for state, never decoration.
enum Symbols {
    static func route(_ key: String) -> String {
        switch key {
        case "layers": "square.3.layers.3d"
        case "satellite": "globe.americas"
        case "terrain": "mountain.2"
        case "elevation": "chart.xyaxis.line"
        case "analyze": "viewfinder"
        case "export": "square.and.arrow.up"
        case "conditions": "cloud.sun"
        case "geology": "exclamationmark.triangle"
        case "past": "clock.arrow.circlepath"
        case "labels": "tag"
        case "markup": "pencil.line"
        case "appearance": "paintpalette"
        case "settings": "gearshape"
        default: "circle"
        }
    }

    /// Lucide names used inside pages.
    static func icon(_ name: String?) -> String? {
        guard let name else { return nil }
        return switch name {
        case "plus": "plus"
        case "eye": "eye"
        case "eye-off": "eye.slash"
        case "chevron-down": "chevron.down"
        case "chevron-up": "chevron.up"
        case "chevron-right": "chevron.right"
        case "pencil", "pen-line": "pencil"
        case "rotate-ccw": "arrow.counterclockwise"
        case "x": "xmark"
        case "trash-2", "trash": "trash"
        case "arrow-up": "arrow.up"
        case "arrow-down": "arrow.down"
        case "check": "checkmark"
        case "search": "magnifyingglass"
        case "layers": "square.stack.3d.up"
        case "circle": "circle.slash"
        case "mountain-snow": "mountain.2"
        case "cloud-sun": "sun.haze"
        case "image": "paintpalette"
        case "waves": "water.waves"
        case "move-up-right": "arrow.up.right"
        case "navigation": "location.north.line"
        case "download": "square.and.arrow.down"
        case "camera": "camera"
        case "scan": "viewfinder"
        case "copy": "doc.on.doc"
        case "satellite": "globe.americas"
        case "settings": "gearshape"
        case "sliders-horizontal": "slider.horizontal.3"
        default: nil
        }
    }

    /// The LiDAR style chooser shows each terrain mode as its own glyph.
    static func terrainStyle(title: String, icon: String?) -> String {
        if title.hasPrefix("Contours") { return "circle.circle" }
        if title.hasPrefix("North") { return "arrow.up.and.down" }
        return Self.icon(icon) ?? "mountain.2"
    }

    static func tool(_ tool: String, mode: String, theme: String) -> String {
        switch tool {
        case "mapMode":
            switch mode {
            case "3d": "mountain.2"
            case "points": "circle.grid.3x3"
            default: "map"
            }
        case "draw": "pencil.line"
        case "snapshot": "camera"
        case "scene": "info.circle"
        case "terrain-source": "square.3.layers.3d"
        case "theme": theme == "dark" ? "moon" : "sun.max"
        case "bearing": "location.north.line"
        case "server": "server.rack"
        default: "circle"
        }
    }
}

extension Color {
    /// "#rrggbb" from the page.
    nonisolated init?(hex: String?) {
        guard let hex, hex.hasPrefix("#"), hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(.sRGB, red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255,
                  blue: Double(value & 0xff) / 255, opacity: 1)
    }

    /// "#rrggbb" for the page, from a picked color.
    var hexString: String {
        let resolved = resolve(in: EnvironmentValues())
        let channel = { (value: Float) in String(format: "%02x", Int((max(0, min(1, value)) * 255).rounded())) }
        return "#" + channel(resolved.red) + channel(resolved.green) + channel(resolved.blue)
    }
}

extension Gradient {
    init(stops: [GradientStop]) {
        self.init(stops: stops.map { stop in
            Gradient.Stop(color: (Color(hex: stop.color) ?? .black).opacity(stop.opacity ?? 1), location: stop.at)
        })
    }
}
