import CSKEngine
import os
import QuartzCore
import SwiftUI
import UIKit

/// The native terrain map (docs/native/ARCHITECTURE.md §4.2), drawn by the
/// engine's GPU renderer into a CAMetalLayer. Gestures move the camera from
/// the main thread; a display link on a dedicated render thread draws, and
/// pauses whenever nothing changes until the map wakes it (a gesture, an
/// animation or an arriving tile).
///
/// Behind the `cspNativeMap` default (e.g. launch argument
/// `-cspNativeMap YES`) until it reaches parity with the web map.
enum NativeMapPreference {
    static let key = "cspNativeMap"
    static var enabled: Bool { UserDefaults.standard.bool(forKey: key) }
}

struct NativeMapRepresentable: UIViewRepresentable {
    let backend: NativeShellBackend
    func makeUIView(context: Context) -> NativeMapView { NativeMapView(backend: backend) }
    func updateUIView(_ view: NativeMapView, context: Context) {}
}

/// Owns the map handle and the render thread. All map calls are thread-safe
/// (csk.h); `free` runs on the render thread once its display link is gone,
/// so no frame can be in progress. Render-thread state is touched only on
/// the render thread.
nonisolated final class MapRenderer: NSObject, @unchecked Sendable {
    private var map: OpaquePointer?
    private var link: CADisplayLink?
    private var runLoop: CFRunLoop?
    private let started = DispatchSemaphore(value: 0)
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "map")
    /// The last logged (resident, in flight, coverage %, failed) state.
    private var logged: (UInt32, UInt32, Int, Bool) = (0, 0, -1, false)

    override init() {
        super.init()
        // The thread keeps the renderer alive until its run loop ends.
        let thread = Thread { self.run() }
        thread.name = "ClearSkies map"
        thread.qualityOfService = .userInteractive
        thread.start()
        started.wait()
    }

    private func run() {
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.isPaused = true
        link.add(to: .current, forMode: .common)
        self.link = link
        runLoop = CFRunLoopGetCurrent()
        started.signal()
        while self.link != nil {
            RunLoop.current.run(mode: .default, before: .distantFuture)
        }
    }

    /// Runs `body` on the render thread.
    func perform(_ body: @escaping @Sendable () -> Void) {
        guard let runLoop else { return }
        CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue, body)
        CFRunLoopWakeUp(runLoop)
    }

    /// The map needs a frame: resume the display link.
    func wake() {
        perform { self.link?.isPaused = false }
    }

    func attach(_ map: OpaquePointer) {
        // csk.h: the map is thread-safe; it moves to the render thread here.
        struct Handle: @unchecked Sendable { let map: OpaquePointer }
        let handle = Handle(map: map)
        perform {
            self.map = handle.map
            self.link?.isPaused = false
        }
    }

    @objc private func tick(_ link: CADisplayLink) {
        guard let map else {
            link.isPaused = true
            return
        }
        #if DEBUG
        let began = CACurrentMediaTime()
        #endif
        var frame = csk_map_frame(map, link.targetTimestamp)
        #if DEBUG
        PerfLog.shared?.frame(began: began, cost: CACurrentMediaTime() - began, presented: frame.presented,
                              coverage: frame.coverage, inFlight: Int(frame.in_flight))
        #endif
        if !frame.again { link.isPaused = true }
        let state = (frame.resident, frame.in_flight, Int(frame.coverage * 100), frame.failed)
        if state != logged {
            logged = state
            if frame.failed {
                let message = withUnsafeBytes(of: &frame.error) { String(cString: $0.bindMemory(to: CChar.self).baseAddress!) }
                Self.logger.error("map frame failed: \(message, privacy: .public)")
            } else {
                Self.logger.debug("map: \(state.0) tiles, \(state.1) loading, \(state.2)% covered")
            }
        }
    }

    /// Frees the map and ends the render thread.
    func shutdown() {
        perform {
            self.link?.invalidate()
            self.link = nil
            if let map = self.map { csk_map_free(map) }
            self.map = nil
            CFRunLoopStop(CFRunLoopGetCurrent())
        }
    }
}

nonisolated private func mapWake(_ context: UnsafeMutableRawPointer?) {
    guard let context else { return }
    Unmanaged<MapRenderer>.fromOpaque(context).takeUnretainedValue().wake()
}

nonisolated private func mapRelease(_ context: UnsafeMutableRawPointer?) {
    guard let context else { return }
    Unmanaged<MapRenderer>.fromOpaque(context).release()
}

final class NativeMapView: UIView, UIGestureRecognizerDelegate {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    private var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "map")
    private let renderer = MapRenderer()
    private var map: OpaquePointer?
    private let backend: NativeShellBackend
    private var pinchScale: CGFloat = 1
    private var pinchCentroid: CGPoint = .zero
    private var rotation: CGFloat = 0
    private var rotationCentroid: CGPoint = .zero
    /// The web map's start-up view (app/map.js CSP_STARTUP_VIEW).
    private static let startup = CskCamera(lon: -117.699455, lat: 47.559373, zoom: 10.04, bearing: 0)

    init(backend: NativeShellBackend) {
        self.backend = backend
        super.init(frame: .zero)
        backend.mapView = self
        metalLayer.isOpaque = false
        metalLayer.framebufferOnly = true
        isMultipleTouchEnabled = true
        let pan = UIPanGestureRecognizer(target: self, action: #selector(pan(_:)))
        pan.maximumNumberOfTouches = 2
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinch(_:)))
        let rotate = UIRotationGestureRecognizer(target: self, action: #selector(rotate(_:)))
        // As on the web map: a tap selects the place under it, and a double
        // tap selects it and searches imagery there (no double-tap zoom).
        let select = UITapGestureRecognizer(target: self, action: #selector(selectPlace(_:)))
        let search = UITapGestureRecognizer(target: self, action: #selector(searchPlace(_:)))
        search.numberOfTapsRequired = 2
        for recognizer in [pan, pinch, rotate, select, search] as [UIGestureRecognizer] {
            recognizer.delegate = self
            addGestureRecognizer(recognizer)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    isolated deinit {
        // The app state lets go of the map before the render thread frees it.
        csk_app_set_map(backend.handle, nil)
        renderer.shutdown()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard let window else { return }
        contentScaleFactor = window.screen.scale
        metalLayer.contentsScale = window.screen.scale
        createIfReady()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if let map {
            csk_map_resize(map, bounds.width, bounds.height, contentScaleFactor)
        } else {
            createIfReady()
        }
    }

    private func createIfReady() {
        guard map == nil, window != nil, bounds.width > 0, bounds.height > 0,
              let engine = EngineRuntime.shared?.handle else { return }
        let context = Unmanaged.passRetained(renderer).toOpaque()
        let wake = CskWake(context: context, wake: mapWake, release: mapRelease)
        let layerPointer = Unmanaged.passUnretained(metalLayer).toOpaque()
        var error = [CChar](repeating: 0, count: 256)
        guard let made = csk_map_new(engine, layerPointer, Self.startup, bounds.width, bounds.height,
                                     contentScaleFactor, wake, &error, error.count) else {
            let reason = String(cString: error)
            Self.logger.error("the native map could not start: \(reason, privacy: .public)")
            return
        }
        Self.logger.notice("native map started at \(self.bounds.width)x\(self.bounds.height) pt, scale \(self.contentScaleFactor)")
        map = made
        csk_app_set_map(backend.handle, made)
        backend.useMapCanvas(MapCanvasColor.theme())
        renderer.attach(made)
    }

    private var now: CFTimeInterval { CACurrentMediaTime() }

    /// Eases the camera to a place, keeping the bearing.
    func ease(lon: Double, lat: Double, zoom: Double) {
        guard let map else { return }
        var target = csk_map_camera(map)
        (target.lon, target.lat, target.zoom) = (lon, lat, zoom)
        csk_map_ease_to(map, now, target, 0.6)
    }

    // MARK: Gestures

    func gestureRecognizer(_ g: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        // Taps pair only with each other (the first tap of a double tap
        // selects at once); camera gestures combine freely.
        (g is UITapGestureRecognizer) == (other is UITapGestureRecognizer)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesBegan(touches, with: event)
        if let map { csk_map_stop(map) }
    }

    @objc private func pan(_ g: UIPanGestureRecognizer) {
        guard let map else { return }
        let delta = g.translation(in: self)
        g.setTranslation(.zero, in: self)
        csk_map_pan(map, delta.x, delta.y)
        if g.state == .ended {
            let velocity = g.velocity(in: self)
            let point = g.location(in: self)
            csk_map_fling(map, now, velocity.x, velocity.y, 0, point.x, point.y)
        }
    }

    @objc private func pinch(_ g: UIPinchGestureRecognizer) {
        guard let map else { return }
        let centroid = g.location(in: self)
        switch g.state {
        case .began:
            pinchScale = g.scale
            pinchCentroid = centroid
        case .changed:
            csk_map_zoom(map, log2(g.scale / pinchScale), centroid.x, centroid.y)
            pinchScale = g.scale
        case .ended:
            // velocity is scale/s; zoom levels/s is its log2 rate.
            let rate = g.velocity / max(g.scale, 0.01) / log(2)
            csk_map_fling(map, now, 0, 0, rate, centroid.x, centroid.y)
        default: break
        }
    }

    @objc private func rotate(_ g: UIRotationGestureRecognizer) {
        guard let map else { return }
        let centroid = g.location(in: self)
        if g.state == .began { rotation = g.rotation }
        guard g.state == .changed else { return }
        let degrees = (g.rotation - rotation) * 180 / .pi
        rotation = g.rotation
        csk_map_rotate(map, degrees, centroid.x, centroid.y)
    }

    @objc private func selectPlace(_ g: UITapGestureRecognizer) {
        let point = g.location(in: self)
        backend.send("selectPoint", ["x": point.x, "y": point.y])
    }

    @objc private func searchPlace(_ g: UITapGestureRecognizer) {
        let point = g.location(in: self)
        backend.send("selectPoint", ["x": point.x, "y": point.y])
        backend.send("searchSelected", [:])
    }
}
