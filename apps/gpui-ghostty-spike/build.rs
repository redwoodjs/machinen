use std::{env, path::PathBuf};

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        panic!("the GPUI + Ghostty spike currently supports macOS only");
    }

    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let desktop_dir = manifest_dir.join("../machinen-desktop");
    let architecture = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        Ok(other) => panic!("unsupported macOS architecture: {other}"),
        Err(error) => panic!("could not determine the target architecture: {error}"),
    };
    let ghostty_slice = desktop_dir
        .join("Dependencies/GhosttyKit.xcframework")
        .join(format!("macos-{architecture}"));
    let ghostty_archive = ghostty_slice.join("libghostty.a");
    let ghostty_header = ghostty_slice.join("Headers/ghostty.h");

    if !ghostty_archive.is_file() || !ghostty_header.is_file() {
        panic!("Ghostty is not prepared. Run ../machinen-desktop/prepare-ghostty.sh first.");
    }

    cc::Build::new()
        .file("src/ghostty_bridge.m")
        .include(ghostty_slice.join("Headers"))
        .flag("-fobjc-arc")
        .warnings(true)
        .compile("ghostty_spike_bridge");

    println!("cargo:rerun-if-changed=src/ghostty_bridge.m");
    println!("cargo:rerun-if-changed={}", ghostty_header.display());
    println!(
        "cargo:rustc-link-arg=-Wl,-force_load,{}",
        ghostty_archive.display()
    );

    for framework in [
        "AppKit",
        "Carbon",
        "CFNetwork",
        "CoreFoundation",
        "CoreGraphics",
        "CoreText",
        "CoreVideo",
        "Foundation",
        "GameController",
        "IOSurface",
        "Metal",
        "QuartzCore",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rustc-link-lib=c++");
}
