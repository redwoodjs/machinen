// Native code-map planning for restore portability proofs.
//
// A captured process can describe code by build ID, module, symbol, and source
// address. A target-native process may place that same symbol at a different
// address. This module maps source code locations to target addresses only when
// the metadata proves the offset is safe.
//
// TypeScript gathers metadata and asks for a deterministic plan. This module
// checks build IDs, symbols, modules, and offsets. If the mapping is unsafe or
// under-described, it returns a structured refusal instead of guessing.
//
// It does not disassemble, emulate, or claim broad restore support; it is the
// native policy helper behind the restore proof command.

const std = @import("std");

const assert = std.debug.assert;

pub const CodeModule = struct {
    id: []const u8,
    logicalName: []const u8,
    path: []const u8,
    arch: ?[]const u8 = null,
    kind: []const u8,
    buildId: []const u8,
    loadBias: []const u8,
    textMapping: []const u8,
};

pub const CodeSymbol = struct {
    name: []const u8,
    mapping: []const u8,
    address: []const u8,
    sizeBytes: ?u64 = null,
    buildId: ?[]const u8 = null,
    metadata: []const u8,
    moduleId: ?[]const u8 = null,
    relativeAddress: ?[]const u8 = null,
};

pub const RequestedLocation = struct {
    id: []const u8,
    symbol: []const u8,
    sourceAddress: ?[]const u8 = null,
};

pub const Request = struct {
    expectedTargetBuildId: []const u8,
    targetBuildId: []const u8,
    sourceSymbols: []const CodeSymbol,
    targetSymbols: []const CodeSymbol,
    requestedLocations: []const RequestedLocation,
    sourceModules: ?[]const CodeModule = null,
    targetModules: ?[]const CodeModule = null,
};

pub const Detail = union(enum) {
    target_build: struct {
        targetBuildId: []const u8,
        expectedTargetBuildId: []const u8,
    },
    target_module_build: struct {
        symbol: []const u8,
        targetModule: []const u8,
        targetBuildId: []const u8,
        expectedTargetBuildId: []const u8,
    },
};

pub const Refusal = struct {
    code: []const u8,
    message: []const u8,
    detail: ?Detail = null,
};

pub const CodeLocationState = enum {
    mapped,
    refused,
};

pub const CodeLocation = struct {
    id: []const u8,
    sourceMapping: []const u8,
    sourceAddress: []const u8,
    targetAddress: ?[]const u8 = null,
    state: CodeLocationState,
    refusal: ?Refusal = null,
};

pub const Result = struct {
    codeLocations: []CodeLocation,
    buildRefusal: ?Refusal = null,
};

pub const PlanError = std.mem.Allocator.Error || error{InvalidInteger};

const code_location_unknown = "code-location-unknown";
const target_build_mismatch = "target-build-mismatch";
const source_symbol_missing = "source symbol is missing";
const target_symbol_missing = "target symbol is missing";
const metadata_missing = "symbol needs DWARF or sidecar size metadata";
const module_metadata_missing = "symbol needs module-relative addresses";
const target_module_missing = "target module is missing";
const source_module_missing = "source module is missing";
const source_address_precedes = "source address precedes symbol";
const source_address_outside = "source address is outside symbol";
const target_symbol_too_small = "target symbol is smaller than captured source offset";
const target_build_message = "target build does not match expected build";
const target_module_build_message = "target module build does not match expected build";

pub fn build(allocator: std.mem.Allocator, request: Request) PlanError!Result {
    assert(request.expectedTargetBuildId.len > 0);

    const locations = try allocator.alignedAlloc(
        CodeLocation,
        null,
        request.requestedLocations.len,
    );
    if (validateTargetBuild(request)) |refusal| {
        for (request.requestedLocations, 0..) |location, i| {
            locations[i] = refusedLocation(location, refusal, null);
        }
        return .{ .codeLocations = locations, .buildRefusal = refusal };
    }

    const source_modules = request.sourceModules orelse &.{};
    const target_modules = request.targetModules orelse &.{};
    for (request.requestedLocations, 0..) |location, i| {
        locations[i] = try mapRequestedLocation(
            allocator,
            location,
            request.sourceSymbols,
            request.targetSymbols,
            source_modules,
            target_modules,
        );
    }
    return .{ .codeLocations = locations };
}

fn validateTargetBuild(request: Request) ?Refusal {
    assert(request.expectedTargetBuildId.len > 0);

    if (std.ascii.eqlIgnoreCase(request.targetBuildId, request.expectedTargetBuildId)) return null;
    return .{
        .code = target_build_mismatch,
        .message = target_build_message,
        .detail = .{ .target_build = .{
            .targetBuildId = request.targetBuildId,
            .expectedTargetBuildId = request.expectedTargetBuildId,
        } },
    };
}

fn mapRequestedLocation(
    allocator: std.mem.Allocator,
    location: RequestedLocation,
    source_symbols: []const CodeSymbol,
    target_symbols: []const CodeSymbol,
    source_modules: []const CodeModule,
    target_modules: []const CodeModule,
) PlanError!CodeLocation {
    assert(location.symbol.len > 0);

    const source = findSymbolByName(source_symbols, location.symbol) orelse
        return refusedLocation(
            location,
            codeRefusal(code_location_unknown, source_symbol_missing),
            null,
        );
    const target = findSymbolByName(target_symbols, location.symbol) orelse
        return refusedLocation(
            location,
            codeRefusal(code_location_unknown, target_symbol_missing),
            source,
        );
    if (validateSymbolMetadata(location.symbol, source, target)) |refusal| {
        return refusedLocation(location, refusal, source);
    }
    const target_address = try resolveTargetAddress(
        allocator,
        location,
        source,
        target,
        source_modules,
        target_modules,
    );
    if (target_address.refusal) |refusal| return refusedLocation(location, refusal, source);
    return .{
        .id = location.id,
        .sourceMapping = source.mapping,
        .sourceAddress = location.sourceAddress orelse source.address,
        .targetAddress = target_address.address,
        .state = .mapped,
    };
}

fn validateSymbolMetadata(symbol: []const u8, source: CodeSymbol, target: CodeSymbol) ?Refusal {
    assert(symbol.len > 0);

    const source_symbol_only = std.mem.eql(u8, source.metadata, "symbol");
    const target_symbol_only = std.mem.eql(u8, target.metadata, "symbol");
    if (source_symbol_only and target_symbol_only and source.sizeBytes == null) {
        return codeRefusal(code_location_unknown, metadata_missing);
    }
    return null;
}

const ResolvedAddress = struct {
    address: ?[]const u8 = null,
    refusal: ?Refusal = null,
};

fn resolveTargetAddress(
    allocator: std.mem.Allocator,
    location: RequestedLocation,
    source: CodeSymbol,
    target: CodeSymbol,
    source_modules: []const CodeModule,
    target_modules: []const CodeModule,
) PlanError!ResolvedAddress {
    assert(location.symbol.len > 0);

    const modules = resolveCodeModules(
        location.symbol,
        source,
        target,
        source_modules,
        target_modules,
    );
    if (modules.refusal) |refusal| return .{ .refusal = refusal };
    if (validateTargetModuleBuild(location.symbol, target, modules.targetModule.?)) |refusal| {
        return .{ .refusal = refusal };
    }
    const offset = try sourceOffsetWithinSymbol(location, source, modules.sourceModule);
    if (offset.refusal) |refusal| return .{ .refusal = refusal };
    if (validateTargetOffset(location.symbol, target, offset.bytes)) |refusal| {
        return .{ .refusal = refusal };
    }
    return .{
        .address = try moduleRelativeAddress(
            allocator,
            modules.targetModule.?,
            target,
            offset.bytes,
        ),
    };
}

const ResolvedModules = struct {
    sourceModule: ?CodeModule = null,
    targetModule: ?CodeModule = null,
    refusal: ?Refusal = null,
};

fn resolveCodeModules(
    symbol: []const u8,
    source: CodeSymbol,
    target: CodeSymbol,
    source_modules: []const CodeModule,
    target_modules: []const CodeModule,
) ResolvedModules {
    assert(symbol.len > 0);

    if (source.moduleId == null and target.moduleId == null) {
        return .{ .targetModule = syntheticAbsoluteModule(target) };
    }
    const missing_metadata = source.moduleId == null or
        target.moduleId == null or
        source.relativeAddress == null or
        target.relativeAddress == null;
    if (missing_metadata) {
        return .{ .refusal = codeRefusal(code_location_unknown, module_metadata_missing) };
    }
    const source_module = findModuleById(source_modules, source.moduleId.?);
    const target_module = findModuleById(target_modules, target.moduleId.?);
    if (source_module) |src| {
        if (target_module) |tgt| return .{ .sourceModule = src, .targetModule = tgt };
        return .{ .refusal = codeRefusal(code_location_unknown, target_module_missing) };
    }
    return .{ .refusal = codeRefusal(code_location_unknown, source_module_missing) };
}

fn syntheticAbsoluteModule(target: CodeSymbol) CodeModule {
    assert(target.mapping.len > 0);

    return .{
        .id = "module:absolute-target",
        .logicalName = "absolute-target",
        .path = "absolute-target",
        .kind = "unknown",
        .buildId = target.buildId orelse "absolute-target",
        .loadBias = "0x0",
        .textMapping = target.mapping,
    };
}

const SourceOffset = struct {
    bytes: u128 = 0,
    refusal: ?Refusal = null,
};

fn sourceOffsetWithinSymbol(
    location: RequestedLocation,
    source: CodeSymbol,
    source_module: ?CodeModule,
) PlanError!SourceOffset {
    assert(location.symbol.len > 0);

    if (source_module == null or source.relativeAddress == null) return .{ .bytes = 0 };
    const source_address_text = location.sourceAddress orelse source.address;
    const source_address = try parseInteger(source_address_text);
    const symbol_address = try parseInteger(source_module.?.loadBias) +
        try parseInteger(source.relativeAddress.?);
    if (source_address < symbol_address) {
        return .{ .refusal = codeRefusal(code_location_unknown, source_address_precedes) };
    }
    const bytes = source_address - symbol_address;
    if (validateSourceOffset(location, source, bytes)) |refusal| return .{ .refusal = refusal };
    return .{ .bytes = bytes };
}

fn validateSourceOffset(location: RequestedLocation, source: CodeSymbol, offset: u128) ?Refusal {
    assert(location.symbol.len > 0);

    const size = source.sizeBytes orelse return null;
    if (offset < size) return null;
    return codeRefusal(code_location_unknown, source_address_outside);
}

fn validateTargetOffset(symbol: []const u8, target: CodeSymbol, offset: u128) ?Refusal {
    assert(symbol.len > 0);

    const size = target.sizeBytes orelse return null;
    if (offset < size) return null;
    return codeRefusal(code_location_unknown, target_symbol_too_small);
}

fn moduleRelativeAddress(
    allocator: std.mem.Allocator,
    target_module: CodeModule,
    target: CodeSymbol,
    offset: u128,
) PlanError![]const u8 {
    assert(target_module.loadBias.len > 0);

    const relative_address = target.relativeAddress orelse return target.address;
    const address = try parseInteger(target_module.loadBias) +
        try parseInteger(relative_address) +
        offset;
    return hex(allocator, address);
}

fn validateTargetModuleBuild(
    symbol: []const u8,
    target: CodeSymbol,
    target_module: CodeModule,
) ?Refusal {
    assert(symbol.len > 0);

    const expected = target.buildId orelse return null;
    if (std.ascii.eqlIgnoreCase(target_module.buildId, expected)) return null;
    return .{
        .code = target_build_mismatch,
        .message = target_module_build_message,
        .detail = .{ .target_module_build = .{
            .symbol = symbol,
            .targetModule = target_module.id,
            .targetBuildId = target_module.buildId,
            .expectedTargetBuildId = expected,
        } },
    };
}

fn refusedLocation(
    location: RequestedLocation,
    refusal: Refusal,
    source: ?CodeSymbol,
) CodeLocation {
    assert(location.id.len > 0);

    return .{
        .id = location.id,
        .sourceMapping = if (source) |symbol| symbol.mapping else "mapping:unknown",
        .sourceAddress = location.sourceAddress orelse
            if (source) |symbol| symbol.address else "0x0",
        .state = .refused,
        .refusal = refusal,
    };
}

fn codeRefusal(code: []const u8, message: []const u8) Refusal {
    assert(code.len > 0);

    return .{ .code = code, .message = message };
}

fn findSymbolByName(symbols: []const CodeSymbol, name: []const u8) ?CodeSymbol {
    assert(name.len > 0);

    var i = symbols.len;
    while (i > 0) {
        i -= 1;
        if (std.mem.eql(u8, symbols[i].name, name)) return symbols[i];
    }
    return null;
}

fn findModuleById(modules: []const CodeModule, id: []const u8) ?CodeModule {
    assert(id.len > 0);

    var i = modules.len;
    while (i > 0) {
        i -= 1;
        if (std.mem.eql(u8, modules[i].id, id)) return modules[i];
    }
    return null;
}

fn parseInteger(text: []const u8) !u128 {
    assert(text.len > 0);

    if (std.mem.startsWith(u8, text, "0x") or std.mem.startsWith(u8, text, "0X")) {
        return std.fmt.parseInt(u128, text[2..], 16) catch error.InvalidInteger;
    }
    return std.fmt.parseInt(u128, text, 10) catch error.InvalidInteger;
}

fn hex(allocator: std.mem.Allocator, value: u128) std.mem.Allocator.Error![]const u8 {
    assert(value <= std.math.maxInt(u128));

    const out = try allocator.alignedAlloc(u8, null, 34);
    return std.fmt.bufPrint(out, "0x{x}", .{value}) catch unreachable;
}

const absolute_request: Request = .{
    .expectedTargetBuildId = "b16b00b5",
    .targetBuildId = "B16B00B5",
    .sourceSymbols = &.{.{
        .name = "resume",
        .mapping = "source",
        .address = "0x400120",
        .sizeBytes = 64,
        .metadata = "dwarf",
    }},
    .targetSymbols = &.{.{
        .name = "resume",
        .mapping = "target",
        .address = "0x14000120",
        .sizeBytes = 72,
        .metadata = "dwarf",
    }},
    .requestedLocations = &.{.{
        .id = "code:resume",
        .symbol = "resume",
        .sourceAddress = "0x400120",
    }},
};

test "build maps absolute symbols" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const result = try build(arena.allocator(), absolute_request);
    try std.testing.expect(result.buildRefusal == null);
    try std.testing.expectEqual(CodeLocationState.mapped, result.codeLocations[0].state);
    try std.testing.expectEqualStrings("0x14000120", result.codeLocations[0].targetAddress.?);
}

const module_request: Request = .{
    .expectedTargetBuildId = "target-lib-build",
    .targetBuildId = "target-lib-build",
    .sourceModules = &.{.{
        .id = "source-lib",
        .logicalName = "lib.so",
        .path = "/source/lib.so",
        .kind = "shared-object",
        .buildId = "source",
        .loadBias = "0xffff80000000",
        .textMapping = "source-text",
    }},
    .targetModules = &.{.{
        .id = "target-lib",
        .logicalName = "lib.so",
        .path = "/target/lib.so",
        .kind = "shared-object",
        .buildId = "target-lib-build",
        .loadBias = "0x7f0000000000",
        .textMapping = "target-text",
    }},
    .sourceSymbols = &.{.{
        .name = "spin",
        .mapping = "source-text",
        .moduleId = "source-lib",
        .address = "0xffff80001120",
        .relativeAddress = "0x1120",
        .sizeBytes = 64,
        .metadata = "dwarf",
    }},
    .targetSymbols = &.{.{
        .name = "spin",
        .mapping = "target-text",
        .moduleId = "target-lib",
        .address = "0x7f00000021a0",
        .relativeAddress = "0x21a0",
        .sizeBytes = 72,
        .buildId = "target-lib-build",
        .metadata = "dwarf",
    }},
    .requestedLocations = &.{.{
        .id = "code:spin",
        .symbol = "spin",
        .sourceAddress = "0xffff80001128",
    }},
};

test "build maps module-relative offsets" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const result = try build(arena.allocator(), module_request);
    try std.testing.expect(result.buildRefusal == null);
    try std.testing.expectEqual(CodeLocationState.mapped, result.codeLocations[0].state);
    try std.testing.expectEqualStrings("0x7f00000021a8", result.codeLocations[0].targetAddress.?);
}

test "build refuses target module build mismatches" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var request = module_request;
    request.expectedTargetBuildId = "expected-target-build";
    const result = try build(arena.allocator(), request);
    try std.testing.expectEqual(CodeLocationState.refused, result.codeLocations[0].state);
    try std.testing.expectEqualStrings(
        target_build_mismatch,
        result.codeLocations[0].refusal.?.code,
    );
}
