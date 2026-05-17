//! Classification of every reg the vCPU dump+load handles.
//! Source of truth is docs/snapshot/sysreg-parity.md.
//!
//! The dump path uses this to decide whether to write a reg at all.
//! The diff tool uses it to decide whether to enforce equality.
//!
//! The classification is conservative: when in doubt, **mask**, so
//! we don't accidentally enforce a check that turns out to be
//! host-dependent.

const std = @import("std");

pub const Class = enum {
    portable, // bytes are guest state — copy verbatim, diff enforces
    mask, // copy verbatim but exclude from diff (PMU counters etc.)
    translate, // needs host-relative adjustment on restore (CNTVOFF)
    skip, // don't transfer — value is host-determined / invariant
};

/// Classify a register by canonical name.
///
/// The matcher does prefix matching for register *families* (e.g. all
/// `DBGBVR<n>_EL1` map to debug), exact match where each member needs
/// a different decision.
pub fn classify(name: []const u8) Class {
    // --- skip: invariant / host-determined ---
    // Identity / discovery
    if (starts_with(name, "ID_AA64") or starts_with(name, "ID_DFR") or
        starts_with(name, "ID_ISAR") or starts_with(name, "ID_MMFR") or
        starts_with(name, "ID_PFR") or starts_with(name, "ID_AFR"))
        return .skip;
    if (eq(name, "MIDR_EL1") or eq(name, "REVIDR_EL1") or
        eq(name, "MPIDR_EL1") or eq(name, "AIDR_EL1") or
        eq(name, "VMPIDR_EL2") or eq(name, "VPIDR_EL2"))
        return .skip;
    // Implementation-defined
    if (eq(name, "ACTLR_EL1") or eq(name, "ACTLR_EL2"))
        return .skip;
    // Apple proprietary
    if (starts_with(name, "S3_1_C15_")) return .skip;
    // Cache topology — host-determined
    if (eq(name, "CCSIDR_EL1") or eq(name, "CCSIDR2_EL1") or
        eq(name, "CSSELR_EL1") or eq(name, "CLIDR_EL1") or
        eq(name, "CTR_EL0") or eq(name, "DCZID_EL0"))
        return .skip;
    // FP feature ID — host caps
    if (starts_with(name, "MVFR")) return .skip;
    // RNG — host RNG, no state
    if (eq(name, "RNDR") or eq(name, "RNDRRS")) return .skip;
    // SME ID — host feature; mismatch must refuse snapshot
    if (eq(name, "SMIDR_EL1")) return .skip;

    // --- translate: host-relative ---
    if (eq(name, "CNTVOFF_EL2") or eq(name, "CNTPOFF_EL2"))
        return .translate;

    // Virtual/physical timer regs are expressed relative to the
    // host counter. Cross-VMM (and even same-VMM fresh-vCPU) load
    // derives new absolute values from the current counter.
    // Classify as mask until the timer translator compensates.
    // CTL appears alongside CVAL because KVM's read computes the
    // enable+masked state at read time, drifting after a write.
    if (eq(name, "CNTV_CTL_EL0") or eq(name, "CNTV_CVAL_EL0") or
        eq(name, "CNTV_TVAL_EL0") or eq(name, "CNTP_CTL_EL0") or
        eq(name, "CNTP_CVAL_EL0") or eq(name, "CNTP_TVAL_EL0"))
        return .mask;

    // --- mask: counters/state that legitimately diverges ---
    // PMU counters
    if (eq(name, "PMCCNTR_EL0") or eq(name, "PMCCFILTR_EL0"))
        return .mask;
    if (starts_with(name, "PMEVCNTR") or starts_with(name, "PMEVTYPER"))
        return .mask;
    if (eq(name, "PMCR_EL0")) return .mask; // E bit + counter clears
    // Debug — mask until task #29 forces portable
    if (starts_with(name, "DBGBVR") or starts_with(name, "DBGBCR") or
        starts_with(name, "DBGWVR") or starts_with(name, "DBGWCR"))
        return .mask;
    if (eq(name, "MDSCR_EL1") or eq(name, "OSDTRRX_EL1") or
        eq(name, "OSDTRTX_EL1") or eq(name, "OSLAR_EL1") or
        eq(name, "OSLSR_EL1") or eq(name, "MDCCINT_EL1") or
        eq(name, "DBGAUTHSTATUS_EL1") or eq(name, "MDCCSR_EL0") or
        eq(name, "DBGCLAIMSET_EL1") or eq(name, "DBGCLAIMCLR_EL1") or
        eq(name, "MDRAR_EL1") or eq(name, "DBGPRCR_EL1"))
        return .mask;

    // --- portable: default for unrecognized regs ---
    // Synthetic ARM-canonical names (S<op0>_<op1>_C<CRn>_C<CRm>_<op2>)
    // for KVM-exposed regs Apple doesn't enumerate. We don't have
    // names for these, so default to portable; the diff will catch
    // anything that legitimately diverges.
    return .portable;
}

fn eq(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

fn starts_with(s: []const u8, prefix: []const u8) bool {
    return std.mem.startsWith(u8, s, prefix);
}

// --- tests ---

test "identity regs are skip" {
    try std.testing.expectEqual(Class.skip, classify("ID_AA64MMFR0_EL1"));
    try std.testing.expectEqual(Class.skip, classify("ID_AA64ISAR0_EL1"));
    try std.testing.expectEqual(Class.skip, classify("MIDR_EL1"));
    try std.testing.expectEqual(Class.skip, classify("MPIDR_EL1"));
}

test "cache topology is skip" {
    try std.testing.expectEqual(Class.skip, classify("CCSIDR_EL1"));
    try std.testing.expectEqual(Class.skip, classify("CTR_EL0"));
}

test "counter offsets are translate" {
    try std.testing.expectEqual(Class.translate, classify("CNTVOFF_EL2"));
    try std.testing.expectEqual(Class.translate, classify("CNTPOFF_EL2"));
}

test "PMU counter regs are mask" {
    try std.testing.expectEqual(Class.mask, classify("PMCCNTR_EL0"));
    try std.testing.expectEqual(Class.mask, classify("PMEVCNTR0_EL0"));
    try std.testing.expectEqual(Class.mask, classify("PMEVTYPER15_EL0"));
    try std.testing.expectEqual(Class.mask, classify("PMCR_EL0"));
}

test "debug regs are mask" {
    try std.testing.expectEqual(Class.mask, classify("DBGBVR0_EL1"));
    try std.testing.expectEqual(Class.mask, classify("DBGWCR15_EL1"));
    try std.testing.expectEqual(Class.mask, classify("MDSCR_EL1"));
}

test "translation regs are portable" {
    try std.testing.expectEqual(Class.portable, classify("SCTLR_EL1"));
    try std.testing.expectEqual(Class.portable, classify("TTBR0_EL1"));
    try std.testing.expectEqual(Class.portable, classify("VBAR_EL1"));
}

test "PAC keys are portable" {
    try std.testing.expectEqual(Class.portable, classify("APIAKEYLO_EL1"));
    try std.testing.expectEqual(Class.portable, classify("APDBKEYHI_EL1"));
}

test "unknown synthetic names default to portable" {
    try std.testing.expectEqual(Class.portable, classify("S3_0_C0_C0_6"));
}

test "GPR / FPR names are portable (used by the dump table)" {
    try std.testing.expectEqual(Class.portable, classify("X0"));
    try std.testing.expectEqual(Class.portable, classify("X30"));
    try std.testing.expectEqual(Class.portable, classify("PC"));
    try std.testing.expectEqual(Class.portable, classify("PSTATE"));
    try std.testing.expectEqual(Class.portable, classify("V0"));
    try std.testing.expectEqual(Class.portable, classify("FPSR"));
    try std.testing.expectEqual(Class.portable, classify("FPCR"));
}
