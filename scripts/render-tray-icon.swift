import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("usage: swift scripts/render-tray-icon.swift <input.svg> <output.png>\n", stderr)
    exit(2)
}

let input = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
guard let source = NSImage(contentsOfFile: input) else {
    fputs("tray icon SVG를 읽지 못했습니다.\n", stderr)
    exit(1)
}

let size = 32
guard
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ),
    let context = NSGraphicsContext(bitmapImageRep: bitmap)
else {
    fputs("tray icon bitmap을 만들지 못했습니다.\n", stderr)
    exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.clear(CGRect(x: 0, y: 0, width: size, height: size))
source.draw(
    in: NSRect(x: 0, y: 0, width: size, height: size),
    from: .zero,
    operation: .sourceOver,
    fraction: 1
)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("tray icon PNG를 만들지 못했습니다.\n", stderr)
    exit(1)
}

do {
    try png.write(to: URL(fileURLWithPath: output), options: .atomic)
} catch {
    fputs("tray icon PNG를 저장하지 못했습니다: \(error)\n", stderr)
    exit(1)
}
