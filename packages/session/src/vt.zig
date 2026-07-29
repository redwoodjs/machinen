const std = @import("std");

/// Renderer-neutral VT checkpoint builder. Format version 1 checkpoints are
/// ordinary VT reconstruction streams: reset, paint the visible cells, and
/// restore the cursor. Any terminal emulator can consume them as output.
pub const format_version: u32 = 1;
pub const default_checkpoint_bytes: u32 = 4 * 1024 * 1024;
pub const max_dimension: u16 = 1_000;

const default_color: u32 = 0;
const rgb_color_tag: u32 = 0x0100_0000;

const attribute_bold: u16 = 1 << 0;
const attribute_faint: u16 = 1 << 1;
const attribute_italic: u16 = 1 << 2;
const attribute_underline: u16 = 1 << 3;
const attribute_blink: u16 = 1 << 4;
const attribute_inverse: u16 = 1 << 5;
const attribute_hidden: u16 = 1 << 6;
const attribute_strikethrough: u16 = 1 << 7;
const attribute_overline: u16 = 1 << 8;
const all_attributes: u16 = attribute_bold | attribute_faint | attribute_italic |
    attribute_underline | attribute_blink | attribute_inverse | attribute_hidden |
    attribute_strikethrough | attribute_overline;

const Rendition = struct {
    attributes: u16 = 0,
    foreground: u32 = default_color,
    background: u32 = default_color,
    underline_color: u32 = default_color,
};

const Cell = struct {
    bytes: [4]u8 = .{ 0, 0, 0, 0 },
    len: u8 = 0,
    rendition: Rendition = .{},
};

const ParseState = enum { ground, escape, csi, osc, osc_escape };
const ColorTarget = enum { foreground, background, underline };
const ByteBuffer = std.ArrayList(u8);

pub const Builder = struct {
    allocator: std.mem.Allocator,
    cells: []Cell,
    inactive_cells: []Cell,
    rows: u16,
    columns: u16,
    cursor_row: u16 = 0,
    cursor_column: u16 = 0,
    saved_row: u16 = 0,
    saved_column: u16 = 0,
    primary_row: u16 = 0,
    primary_column: u16 = 0,
    in_alternate_screen: bool = false,
    state: ParseState = .ground,
    params: [16]u16 = [_]u16{0} ** 16,
    param_separators: [16]u8 = [_]u8{0} ** 16,
    param_count: u8 = 1,
    parameter_started: bool = false,
    csi_private: bool = false,
    rendition: Rendition = .{},
    utf8_remaining: u3 = 0,
    last_cell: ?usize = null,
    bytes_since_checkpoint: u64 = 0,

    pub fn init(allocator: std.mem.Allocator, rows: u16, columns: u16) !Builder {
        try validateSize(rows, columns);
        const cells = try allocator.alloc(Cell, @as(usize, rows) * columns);
        errdefer allocator.free(cells);
        const inactive_cells = try allocator.alloc(Cell, @as(usize, rows) * columns);
        @memset(cells, .{});
        @memset(inactive_cells, .{});
        return .{
            .allocator = allocator,
            .cells = cells,
            .inactive_cells = inactive_cells,
            .rows = rows,
            .columns = columns,
        };
    }

    pub fn deinit(self: *Builder) void {
        self.allocator.free(self.cells);
        self.allocator.free(self.inactive_cells);
        self.* = undefined;
    }

    pub fn feed(self: *Builder, bytes: []const u8) void {
        self.bytes_since_checkpoint +|= bytes.len;
        for (bytes) |byte| self.feedByte(byte);
    }

    pub fn resize(self: *Builder, rows: u16, columns: u16) !void {
        try validateSize(rows, columns);
        if (rows == self.rows and columns == self.columns) return;
        const replacement = try resizedCells(
            self.allocator,
            self.cells,
            self.rows,
            self.columns,
            rows,
            columns,
        );
        errdefer self.allocator.free(replacement);
        const inactive_replacement = try resizedCells(
            self.allocator,
            self.inactive_cells,
            self.rows,
            self.columns,
            rows,
            columns,
        );
        self.allocator.free(self.cells);
        self.allocator.free(self.inactive_cells);
        self.cells = replacement;
        self.inactive_cells = inactive_replacement;
        self.rows = rows;
        self.columns = columns;
        self.cursor_row = @min(self.cursor_row, rows - 1);
        self.cursor_column = @min(self.cursor_column, columns - 1);
        self.last_cell = null;
    }

    pub fn shouldCheckpoint(self: Builder, threshold: u32) bool {
        return threshold > 0 and self.bytes_since_checkpoint >= threshold;
    }

    pub fn checkpoint(self: *Builder) ![]u8 {
        var output: ByteBuffer = .empty;
        errdefer output.deinit(self.allocator);
        try output.appendSlice(self.allocator, "\x1bc");
        var emitted_rendition: Rendition = .{};
        for (0..self.rows) |row| {
            const end = self.lastOccupiedColumn(row) orelse continue;
            try appendCursor(self.allocator, &output, row + 1, 1);
            for (0..end + 1) |column| {
                const cell = self.cells[row * self.columns + column];
                if (!renditionsEqual(emitted_rendition, cell.rendition)) {
                    try appendRendition(self.allocator, &output, cell.rendition);
                    emitted_rendition = cell.rendition;
                }
                if (cell.len == 0) {
                    try output.append(self.allocator, ' ');
                } else {
                    try output.appendSlice(self.allocator, cell.bytes[0..cell.len]);
                }
            }
        }
        // The child may rely on the active SGR state for its next output, so a
        // replay must restore more than the rendition of the final painted cell.
        if (!renditionsEqual(emitted_rendition, self.rendition)) {
            try appendRendition(self.allocator, &output, self.rendition);
        }
        try appendCursor(
            self.allocator,
            &output,
            @as(usize, self.cursor_row) + 1,
            @as(usize, self.cursor_column) + 1,
        );
        return output.toOwnedSlice(self.allocator);
    }

    pub fn didCheckpoint(self: *Builder) void {
        self.bytes_since_checkpoint = 0;
    }

    fn feedByte(self: *Builder, byte: u8) void {
        switch (self.state) {
            .ground => self.feedGround(byte),
            .escape => self.feedEscape(byte),
            .csi => self.feedCsi(byte),
            .osc => if (byte == 0x07) {
                self.state = .ground;
            } else if (byte == 0x1b) {
                self.state = .osc_escape;
            },
            .osc_escape => self.state = if (byte == '\\') .ground else .osc,
        }
    }

    fn feedGround(self: *Builder, byte: u8) void {
        if (self.utf8_remaining > 0 and byte >= 0x80 and byte <= 0xbf) {
            if (self.last_cell) |index| {
                var cell = &self.cells[index];
                if (cell.len < cell.bytes.len) {
                    cell.bytes[cell.len] = byte;
                    cell.len += 1;
                }
            }
            self.utf8_remaining -= 1;
            return;
        }
        self.utf8_remaining = 0;
        self.last_cell = null;
        switch (byte) {
            0x1b => self.state = .escape,
            '\r' => self.cursor_column = 0,
            '\n', 0x0b, 0x0c => self.lineFeed(),
            0x08 => self.cursor_column -|= 1,
            '\t' => self.cursor_column = @min(
                @as(u16, @intCast((@as(u32, self.cursor_column) + 8) & ~@as(u32, 7))),
                self.columns - 1,
            ),
            0x20...0x7e => self.putCharacter(byte, 0),
            0xc2...0xdf => self.putCharacter(byte, 1),
            0xe0...0xef => self.putCharacter(byte, 2),
            0xf0...0xf4 => self.putCharacter(byte, 3),
            else => {},
        }
    }

    fn feedEscape(self: *Builder, byte: u8) void {
        self.state = .ground;
        switch (byte) {
            '[' => self.beginCsi(),
            ']' => self.state = .osc,
            '7' => self.saveCursor(),
            '8' => self.restoreCursor(),
            'D' => self.lineFeed(),
            'E' => {
                self.cursor_column = 0;
                self.lineFeed();
            },
            'M' => self.reverseIndex(),
            'c' => self.reset(),
            else => {},
        }
    }

    fn beginCsi(self: *Builder) void {
        self.state = .csi;
        self.params = [_]u16{0} ** self.params.len;
        self.param_separators = [_]u8{0} ** self.param_separators.len;
        self.param_count = 1;
        self.parameter_started = false;
        self.csi_private = false;
    }

    fn feedCsi(self: *Builder, byte: u8) void {
        if (byte >= '0' and byte <= '9') {
            const index = self.param_count - 1;
            self.params[index] = self.params[index] *| 10 +| byte - '0';
            self.parameter_started = true;
            return;
        }
        if (byte == ';' or byte == ':') {
            if (self.param_count < self.params.len) {
                self.param_separators[self.param_count] = byte;
                self.param_count += 1;
            }
            self.parameter_started = false;
            return;
        }
        if (byte == '?' or byte == '>' or byte == '!') {
            if (byte == '?') self.csi_private = true;
            return;
        }
        if (byte >= 0x40 and byte <= 0x7e) {
            self.executeCsi(byte);
            self.state = .ground;
        }
    }

    fn executeCsi(self: *Builder, final: u8) void {
        const first = self.parameter(0, 1);
        switch (final) {
            'A' => self.cursor_row -|= first,
            'B' => self.cursor_row = @min(self.cursor_row +| first, self.rows - 1),
            'C', 'a' => self.cursor_column = @min(self.cursor_column +| first, self.columns - 1),
            'D' => self.cursor_column -|= first,
            'E' => {
                self.cursor_row = @min(self.cursor_row +| first, self.rows - 1);
                self.cursor_column = 0;
            },
            'F' => {
                self.cursor_row -|= first;
                self.cursor_column = 0;
            },
            'G', '`' => self.cursor_column = @min(first -| 1, self.columns - 1),
            'H', 'f' => {
                self.cursor_row = @min(self.parameter(0, 1) -| 1, self.rows - 1);
                self.cursor_column = @min(self.parameter(1, 1) -| 1, self.columns - 1);
            },
            'd' => self.cursor_row = @min(first -| 1, self.rows - 1),
            'J' => self.eraseDisplay(self.parameter(0, 0)),
            'K' => self.eraseLine(self.parameter(0, 0)),
            '@' => self.insertCells(first),
            'P' => self.deleteCells(first),
            'X' => self.eraseCells(first),
            'L' => self.insertLines(first),
            'M' => self.deleteLines(first),
            'S' => for (0..first) |_| self.scrollUp(),
            'T' => for (0..first) |_| self.scrollDown(),
            's' => self.saveCursor(),
            'u' => self.restoreCursor(),
            'h' => if (self.csi_private) self.setPrivateMode(true),
            'l' => if (self.csi_private) self.setPrivateMode(false),
            'm' => self.applySgr(),
            else => {},
        }
    }

    fn applySgr(self: *Builder) void {
        std.debug.assert(self.param_count > 0 and self.param_count <= self.params.len);
        var index: u8 = 0;
        while (index < self.param_count) : (index += 1) {
            const code = self.params[index];
            switch (code) {
                0 => self.rendition = .{},
                1 => self.rendition.attributes |= attribute_bold,
                2 => self.rendition.attributes |= attribute_faint,
                3 => self.rendition.attributes |= attribute_italic,
                4, 21 => {
                    self.rendition.attributes |= attribute_underline;
                    if (index + 1 < self.param_count and self.param_separators[index + 1] == ':') {
                        index += 1;
                    }
                },
                5, 6 => self.rendition.attributes |= attribute_blink,
                7 => self.rendition.attributes |= attribute_inverse,
                8 => self.rendition.attributes |= attribute_hidden,
                9 => self.rendition.attributes |= attribute_strikethrough,
                22 => self.rendition.attributes &= ~(attribute_bold | attribute_faint),
                23 => self.rendition.attributes &= ~attribute_italic,
                24 => self.rendition.attributes &= ~attribute_underline,
                25 => self.rendition.attributes &= ~attribute_blink,
                27 => self.rendition.attributes &= ~attribute_inverse,
                28 => self.rendition.attributes &= ~attribute_hidden,
                29 => self.rendition.attributes &= ~attribute_strikethrough,
                30...37 => self.rendition.foreground = indexedColor(code - 30),
                38 => index = self.applyExtendedColor(index, .foreground),
                39 => self.rendition.foreground = default_color,
                40...47 => self.rendition.background = indexedColor(code - 40),
                48 => index = self.applyExtendedColor(index, .background),
                49 => self.rendition.background = default_color,
                53 => self.rendition.attributes |= attribute_overline,
                55 => self.rendition.attributes &= ~attribute_overline,
                58 => index = self.applyExtendedColor(index, .underline),
                59 => self.rendition.underline_color = default_color,
                90...97 => self.rendition.foreground = indexedColor(8 + code - 90),
                100...107 => self.rendition.background = indexedColor(8 + code - 100),
                else => {},
            }
        }
    }

    fn applyExtendedColor(self: *Builder, start: u8, target: ColorTarget) u8 {
        std.debug.assert(start < self.param_count);
        const mode_index = start + 1;
        if (mode_index >= self.param_count) return start;
        const mode = self.params[mode_index];
        if (mode == 5) {
            const color_index = mode_index + 1;
            if (color_index >= self.param_count) return mode_index;
            self.setColor(target, indexedColor(self.params[color_index]));
            return color_index;
        }
        if (mode != 2) return mode_index;

        var red_index = mode_index + 1;
        // ISO colon-form truecolor has an optional color-space slot:
        // 38:2:<space>:<r>:<g>:<b>. Accept both that and 38:2:r:g:b.
        if (self.param_separators[mode_index] == ':' and self.param_count - start >= 6) {
            red_index += 1;
        }
        if (red_index + 2 >= self.param_count) return mode_index;
        self.setColor(
            target,
            rgbColor(
                self.params[red_index],
                self.params[red_index + 1],
                self.params[red_index + 2],
            ),
        );
        return red_index + 2;
    }

    fn setColor(self: *Builder, target: ColorTarget, color: u32) void {
        std.debug.assert(color <= 256 or color >> 24 == rgb_color_tag >> 24);
        switch (target) {
            .foreground => self.rendition.foreground = color,
            .background => self.rendition.background = color,
            .underline => self.rendition.underline_color = color,
        }
    }

    fn parameter(self: Builder, index: usize, default: u16) u16 {
        if (index >= self.param_count or self.params[index] == 0) return default;
        return self.params[index];
    }

    fn putCharacter(self: *Builder, byte: u8, continuation: u3) void {
        if (self.cursor_column >= self.columns) {
            self.cursor_column = 0;
            self.lineFeed();
        }
        const index = @as(usize, self.cursor_row) * self.columns + self.cursor_column;
        self.cells[index] = .{
            .bytes = .{ byte, 0, 0, 0 },
            .len = 1,
            .rendition = self.rendition,
        };
        self.last_cell = index;
        self.utf8_remaining = continuation;
        self.cursor_column += 1;
    }

    fn lineFeed(self: *Builder) void {
        if (self.cursor_row + 1 < self.rows) {
            self.cursor_row += 1;
        } else {
            self.scrollUp();
        }
    }

    fn reverseIndex(self: *Builder) void {
        if (self.cursor_row > 0) {
            self.cursor_row -= 1;
        } else {
            self.scrollDown();
        }
    }

    fn scrollUp(self: *Builder) void {
        const columns: usize = self.columns;
        if (self.cells.len > columns) {
            std.mem.copyForwards(
                Cell,
                self.cells[0 .. self.cells.len - columns],
                self.cells[columns..],
            );
        }
        @memset(self.cells[self.cells.len - columns ..], blankCell(self.rendition));
    }

    fn scrollDown(self: *Builder) void {
        const columns: usize = self.columns;
        if (self.cells.len > columns) {
            std.mem.copyBackwards(
                Cell,
                self.cells[columns..],
                self.cells[0 .. self.cells.len - columns],
            );
        }
        @memset(self.cells[0..columns], blankCell(self.rendition));
    }

    fn eraseDisplay(self: *Builder, mode: u16) void {
        const index = @as(usize, self.cursor_row) * self.columns + self.cursor_column;
        const blank = blankCell(self.rendition);
        switch (mode) {
            0 => @memset(self.cells[index..], blank),
            1 => @memset(self.cells[0 .. index + 1], blank),
            2, 3 => @memset(self.cells, blank),
            else => {},
        }
    }

    fn eraseLine(self: *Builder, mode: u16) void {
        const start = @as(usize, self.cursor_row) * self.columns;
        const cursor = start + self.cursor_column;
        const blank = blankCell(self.rendition);
        switch (mode) {
            0 => @memset(self.cells[cursor .. start + self.columns], blank),
            1 => @memset(self.cells[start .. cursor + 1], blank),
            2 => @memset(self.cells[start .. start + self.columns], blank),
            else => {},
        }
    }

    fn insertCells(self: *Builder, amount: u16) void {
        const start = @as(usize, self.cursor_row) * self.columns;
        const cursor = start + self.cursor_column;
        const count = @min(amount, self.columns - self.cursor_column);
        const end = start + self.columns;
        if (count < end - cursor) {
            std.mem.copyBackwards(
                Cell,
                self.cells[cursor + count .. end],
                self.cells[cursor .. end - count],
            );
        }
        @memset(self.cells[cursor .. cursor + count], blankCell(self.rendition));
    }

    fn deleteCells(self: *Builder, amount: u16) void {
        const start = @as(usize, self.cursor_row) * self.columns;
        const cursor = start + self.cursor_column;
        const count = @min(amount, self.columns - self.cursor_column);
        const end = start + self.columns;
        if (count < end - cursor) {
            std.mem.copyForwards(
                Cell,
                self.cells[cursor .. end - count],
                self.cells[cursor + count .. end],
            );
        }
        @memset(self.cells[end - count .. end], blankCell(self.rendition));
    }

    fn eraseCells(self: *Builder, amount: u16) void {
        const start = @as(usize, self.cursor_row) * self.columns + self.cursor_column;
        const count = @min(amount, self.columns - self.cursor_column);
        @memset(self.cells[start .. start + count], blankCell(self.rendition));
    }

    fn insertLines(self: *Builder, amount: u16) void {
        const start_row = self.cursor_row;
        const count = @min(amount, self.rows - start_row);
        const columns: usize = self.columns;
        const start = @as(usize, start_row) * columns;
        const shift = @as(usize, count) * columns;
        if (shift < self.cells.len - start) {
            std.mem.copyBackwards(
                Cell,
                self.cells[start + shift ..],
                self.cells[start .. self.cells.len - shift],
            );
        }
        @memset(self.cells[start .. start + shift], blankCell(self.rendition));
    }

    fn deleteLines(self: *Builder, amount: u16) void {
        const start_row = self.cursor_row;
        const count = @min(amount, self.rows - start_row);
        const columns: usize = self.columns;
        const start = @as(usize, start_row) * columns;
        const shift = @as(usize, count) * columns;
        if (shift < self.cells.len - start) {
            std.mem.copyForwards(
                Cell,
                self.cells[start .. self.cells.len - shift],
                self.cells[start + shift ..],
            );
        }
        @memset(self.cells[self.cells.len - shift ..], blankCell(self.rendition));
    }

    fn setPrivateMode(self: *Builder, enabled: bool) void {
        for (self.params[0..self.param_count]) |mode| {
            if (mode == 47 or mode == 1047 or mode == 1049) {
                if (enabled) self.enterAlternateScreen() else self.leaveAlternateScreen();
            }
        }
    }

    fn enterAlternateScreen(self: *Builder) void {
        if (self.in_alternate_screen) return;
        self.primary_row = self.cursor_row;
        self.primary_column = self.cursor_column;
        std.mem.swap([]Cell, &self.cells, &self.inactive_cells);
        @memset(self.cells, .{});
        self.cursor_row = 0;
        self.cursor_column = 0;
        self.in_alternate_screen = true;
    }

    fn leaveAlternateScreen(self: *Builder) void {
        if (!self.in_alternate_screen) return;
        std.mem.swap([]Cell, &self.cells, &self.inactive_cells);
        self.cursor_row = @min(self.primary_row, self.rows - 1);
        self.cursor_column = @min(self.primary_column, self.columns - 1);
        self.in_alternate_screen = false;
    }

    fn saveCursor(self: *Builder) void {
        self.saved_row = self.cursor_row;
        self.saved_column = self.cursor_column;
    }

    fn restoreCursor(self: *Builder) void {
        self.cursor_row = @min(self.saved_row, self.rows - 1);
        self.cursor_column = @min(self.saved_column, self.columns - 1);
    }

    fn reset(self: *Builder) void {
        if (self.in_alternate_screen) self.leaveAlternateScreen();
        @memset(self.cells, .{});
        @memset(self.inactive_cells, .{});
        self.cursor_row = 0;
        self.cursor_column = 0;
        self.saved_row = 0;
        self.saved_column = 0;
        self.rendition = .{};
        self.utf8_remaining = 0;
        self.last_cell = null;
    }

    fn lastOccupiedColumn(self: Builder, row: usize) ?usize {
        var column: usize = self.columns;
        while (column > 0) {
            column -= 1;
            const cell = self.cells[row * self.columns + column];
            if (cell.len > 0 or blankRenditionIsVisible(cell.rendition)) return column;
        }
        return null;
    }
};

fn resizedCells(
    allocator: std.mem.Allocator,
    source: []const Cell,
    old_rows: u16,
    old_columns: u16,
    rows: u16,
    columns: u16,
) ![]Cell {
    const replacement = try allocator.alloc(Cell, @as(usize, rows) * columns);
    @memset(replacement, .{});
    const copy_rows = @min(rows, old_rows);
    const copy_columns = @min(columns, old_columns);
    for (0..copy_rows) |row| {
        const old_start = row * old_columns;
        const new_start = row * columns;
        @memcpy(
            replacement[new_start .. new_start + copy_columns],
            source[old_start .. old_start + copy_columns],
        );
    }
    return replacement;
}

fn indexedColor(index: u16) u32 {
    const result = @as(u32, @min(index, 255)) + 1;
    std.debug.assert(result >= 1 and result <= 256);
    return result;
}

fn rgbColor(red: u16, green: u16, blue: u16) u32 {
    const result = rgb_color_tag |
        (@as(u32, @min(red, 255)) << 16) |
        (@as(u32, @min(green, 255)) << 8) |
        @as(u32, @min(blue, 255));
    std.debug.assert(result >> 24 == rgb_color_tag >> 24);
    return result;
}

fn blankCell(rendition: Rendition) Cell {
    std.debug.assert(rendition.attributes & ~all_attributes == 0);
    return .{ .rendition = rendition };
}

fn renditionsEqual(left: Rendition, right: Rendition) bool {
    std.debug.assert((left.attributes | right.attributes) & ~all_attributes == 0);
    return left.attributes == right.attributes and
        left.foreground == right.foreground and
        left.background == right.background and
        left.underline_color == right.underline_color;
}

fn blankRenditionIsVisible(rendition: Rendition) bool {
    std.debug.assert(rendition.attributes & ~all_attributes == 0);
    const visible_attributes = attribute_underline |
        attribute_inverse |
        attribute_strikethrough |
        attribute_overline;
    return rendition.background != default_color or
        rendition.attributes & visible_attributes != 0;
}

fn appendRendition(
    allocator: std.mem.Allocator,
    output: *ByteBuffer,
    rendition: Rendition,
) !void {
    std.debug.assert(rendition.attributes & ~all_attributes == 0);
    try output.appendSlice(allocator, "\x1b[0");
    if (rendition.attributes & attribute_bold != 0) try appendSgrParameter(allocator, output, 1);
    if (rendition.attributes & attribute_faint != 0) try appendSgrParameter(allocator, output, 2);
    if (rendition.attributes & attribute_italic != 0) try appendSgrParameter(allocator, output, 3);
    if (rendition.attributes & attribute_underline != 0) {
        try appendSgrParameter(allocator, output, 4);
    }
    if (rendition.attributes & attribute_blink != 0) try appendSgrParameter(allocator, output, 5);
    if (rendition.attributes & attribute_inverse != 0) try appendSgrParameter(allocator, output, 7);
    if (rendition.attributes & attribute_hidden != 0) try appendSgrParameter(allocator, output, 8);
    if (rendition.attributes & attribute_strikethrough != 0) {
        try appendSgrParameter(allocator, output, 9);
    }
    if (rendition.attributes & attribute_overline != 0) {
        try appendSgrParameter(allocator, output, 53);
    }
    try appendColor(allocator, output, rendition.foreground, .foreground);
    try appendColor(allocator, output, rendition.background, .background);
    try appendColor(allocator, output, rendition.underline_color, .underline);
    try output.append(allocator, 'm');
}

fn appendColor(
    allocator: std.mem.Allocator,
    output: *ByteBuffer,
    color: u32,
    target: ColorTarget,
) !void {
    std.debug.assert(color <= 256 or color >> 24 == rgb_color_tag >> 24);
    if (color == default_color) return;
    if (color & rgb_color_tag != 0) {
        try appendSgrParameter(allocator, output, switch (target) {
            .foreground => 38,
            .background => 48,
            .underline => 58,
        });
        try appendSgrParameter(allocator, output, 2);
        try appendSgrParameter(allocator, output, (color >> 16) & 0xff);
        try appendSgrParameter(allocator, output, (color >> 8) & 0xff);
        try appendSgrParameter(allocator, output, color & 0xff);
        return;
    }

    const palette_index = color - 1;
    if (target == .foreground and palette_index < 8) {
        return appendSgrParameter(allocator, output, 30 + palette_index);
    }
    if (target == .foreground and palette_index < 16) {
        return appendSgrParameter(allocator, output, 90 + palette_index - 8);
    }
    if (target == .background and palette_index < 8) {
        return appendSgrParameter(allocator, output, 40 + palette_index);
    }
    if (target == .background and palette_index < 16) {
        return appendSgrParameter(allocator, output, 100 + palette_index - 8);
    }
    try appendSgrParameter(allocator, output, switch (target) {
        .foreground => 38,
        .background => 48,
        .underline => 58,
    });
    try appendSgrParameter(allocator, output, 5);
    try appendSgrParameter(allocator, output, palette_index);
}

fn appendSgrParameter(
    allocator: std.mem.Allocator,
    output: *ByteBuffer,
    value: u32,
) !void {
    var buffer: [16]u8 = undefined;
    std.debug.assert(buffer.len >= 11);
    const text = try std.fmt.bufPrint(&buffer, ";{d}", .{value});
    try output.appendSlice(allocator, text);
}

fn appendCursor(
    allocator: std.mem.Allocator,
    output: *ByteBuffer,
    row: usize,
    column: usize,
) !void {
    var buffer: [48]u8 = undefined;
    const value = try std.fmt.bufPrint(&buffer, "\x1b[{d};{d}H", .{ row, column });
    try output.appendSlice(allocator, value);
}

fn validateSize(rows: u16, columns: u16) !void {
    if (rows == 0 or columns == 0 or rows > max_dimension or columns > max_dimension) {
        return error.InvalidTerminalSize;
    }
}

test "checkpoint reconstructs visible cells and cursor as portable VT output" {
    const allocator = std.testing.allocator;
    var builder = try Builder.init(allocator, 3, 8);
    defer builder.deinit();
    builder.feed("hello\r\nworld\x1b[2;3H!");
    const checkpoint = try builder.checkpoint();
    defer allocator.free(checkpoint);
    try std.testing.expect(std.mem.startsWith(u8, checkpoint, "\x1bc"));
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "hello") != null);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "wo!ld") != null);
    try std.testing.expect(std.mem.endsWith(u8, checkpoint, "\x1b[2;4H"));
}

test "checkpoint preserves ANSI attributes and indexed and RGB colors" {
    const allocator = std.testing.allocator;
    var builder = try Builder.init(allocator, 2, 32);
    defer builder.deinit();
    builder.feed(
        "\x1b[1;31mred\x1b[38;5;208morange" ++
            "\x1b[48;2;1;2;3m rgb\x1b[0m plain",
    );
    const checkpoint = try builder.checkpoint();
    defer allocator.free(checkpoint);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "\x1b[0;1;31mred") != null);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "\x1b[0;1;38;5;208morange") != null);
    try std.testing.expect(
        std.mem.indexOf(u8, checkpoint, "\x1b[0;1;38;5;208;48;2;1;2;3m rgb") != null,
    );
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "\x1b[0m plain") != null);
}

test "checkpoint preserves colored blank cells and the active rendition" {
    const allocator = std.testing.allocator;
    var builder = try Builder.init(allocator, 2, 8);
    defer builder.deinit();
    builder.feed("\x1b[44m   \x1b[32m");
    const checkpoint = try builder.checkpoint();
    defer allocator.free(checkpoint);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "\x1b[0;44m   ") != null);
    try std.testing.expect(std.mem.endsWith(u8, checkpoint, "\x1b[0;32;44m\x1b[1;4H"));
}

test "checkpoint accepts colon-form RGB colors" {
    const allocator = std.testing.allocator;
    var builder = try Builder.init(allocator, 1, 8);
    defer builder.deinit();
    builder.feed("\x1b[38:2::12:34:56mcolor");
    const checkpoint = try builder.checkpoint();
    defer allocator.free(checkpoint);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "\x1b[0;38;2;12;34;56mcolor") != null);
}

test "alternate-screen applications restore the primary screen on exit" {
    const allocator = std.testing.allocator;
    var builder = try Builder.init(allocator, 3, 12);
    defer builder.deinit();
    builder.feed("shell\x1b[?1049heditor\x1b[?1049l prompt");
    const checkpoint = try builder.checkpoint();
    defer allocator.free(checkpoint);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "shell prompt") != null);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "editor") == null);
}

test "checkpoint builder follows erase resize and scrolling" {
    const allocator = std.testing.allocator;
    var builder = try Builder.init(allocator, 2, 4);
    defer builder.deinit();
    builder.feed("one\r\ntwo\r\ntri");
    try builder.resize(3, 5);
    builder.feed("\x1b[2J\x1b[1;1Hx");
    const checkpoint = try builder.checkpoint();
    defer allocator.free(checkpoint);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "one") == null);
    try std.testing.expect(std.mem.indexOf(u8, checkpoint, "x") != null);
}
