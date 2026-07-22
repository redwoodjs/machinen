# Machinen SwiftTerm vendor notes

This is SwiftTerm revision `dd2fb8ac5b861e7bf617c872895e338f38165648`.

Machinen keeps SwiftTerm vendored so terminal rendering fixes are reproducible.

## Local patch

`Sources/SwiftTerm/Apple/AppleTerminalView.swift` caches the resolved
`NSAttributedString` attributes while building each screen row. Consecutive
cells with the same terminal attribute and link state no longer hash the same
`Attribute` into the SwiftTerm attribute cache once per cell. The row text
buffer also retains its capacity between attributed-string runs.

The patch preserves the renderer's selection, URL, width, and glyph behavior;
it changes only repeated lookup/allocation work in the common single-style
terminal-output path. The cached CoreText run wrappers retain both the `CTRun`
and its resolved attributes; the drawing loops use those values directly. This
also keeps the vendor build valid under Swift 6.
