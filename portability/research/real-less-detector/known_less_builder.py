#!/usr/bin/env python3
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

SOURCE_URL = "https://www.greenwoodsoftware.com/less/less-643.tar.gz"
SOURCE_SHA256 = "2911b5432c836fa084c8a2e68f6cd6312372c026a58faaa98862731c8b6052e8"
SOURCE_DIR = "less-643"
NCURSES_URL = "https://ftp.gnu.org/gnu/ncurses/ncurses-6.4.tar.gz"
NCURSES_SHA256 = "6931283d9ac87c5073f30b6290c4c75f21632bb4fc3603ac8100812bed248159"
NCURSES_DIR = "ncurses-6.4"
MARKER_SYMBOL = "machinen_less_ready_before_input_marker"
GATE_SYMBOL = "machinen_less_ready_before_input_gate"


def run(command, cwd=None, env=None):
    result = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"command failed ({result.returncode}): {' '.join(command)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result.stdout


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_archive(cache_dir, name, url, expected_sha256):
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / name
    if not archive.exists() or sha256(archive) != expected_sha256:
        urllib.request.urlretrieve(url, archive)
    actual = sha256(archive)
    if actual != expected_sha256:
        raise RuntimeError(f"source sha256 mismatch for {name}: expected {expected_sha256}, got {actual}")
    return archive


def download_source(cache_dir):
    return download_archive(cache_dir, "less-643.tar.gz", SOURCE_URL, SOURCE_SHA256)


def download_ncurses(cache_dir):
    return download_archive(cache_dir, "ncurses-6.4.tar.gz", NCURSES_URL, NCURSES_SHA256)


def extract_source(archive, build_root):
    source_root = build_root / SOURCE_DIR
    if source_root.exists():
        shutil.rmtree(source_root)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(build_root)
    return source_root


def patch_command_c(source_root):
    command_c = source_root / "command.c"
    command_c.chmod(command_c.stat().st_mode | 0o200)
    text = command_c.read_text(encoding="utf-8")
    marker = """
#if defined(__GNUC__)
#define MACHINEN_NOINLINE __attribute__((noinline))
#else
#define MACHINEN_NOINLINE
#endif

public volatile int machinen_less_ready_before_input_gate = 0;

public void MACHINEN_NOINLINE machinen_less_ready_before_input_marker(void)
{
	if (lgetenv("MACHINEN_LESS_SPIN_AT_READY") != NULL)
	{
		while (machinen_less_ready_before_input_gate == 0)
		{
			/* Intentional marker safe-point spin for Machinen research. */
		}
	}
}
"""
    insert_after = "static long fraction;           /* The fractional part of the number */\n"
    if MARKER_SYMBOL not in text:
        if insert_after not in text:
            raise RuntimeError("could not find command.c marker insertion point")
        text = text.replace(insert_after, insert_after + marker, 1)
    old = """\t\tif (newaction == A_NOACTION)
\t\t\tc = getcc();
"""
    new = """\t\tif (newaction == A_NOACTION)
\t\t{
\t\t\tflush();
\t\t\tmachinen_less_ready_before_input_marker();
\t\t\tc = getcc();
\t\t}
"""
    if new not in text:
        if old not in text:
            raise RuntimeError("could not find getcc call insertion point")
        text = text.replace(old, new, 1)
    command_c.write_text(text, encoding="utf-8")


def system_library_path(library_name):
    stdout, _, code = command_or_empty(["ldconfig", "-p"])
    if code == 0:
        for line in stdout.splitlines():
            if f"{library_name}.so.6" in line and "=>" in line:
                return Path(line.split("=>", 1)[1].strip())
    for directory in (Path("/lib"), Path("/usr/lib"), Path("/lib/aarch64-linux-gnu"), Path("/usr/lib/aarch64-linux-gnu"), Path("/lib/x86_64-linux-gnu"), Path("/usr/lib/x86_64-linux-gnu")):
        candidate = directory / f"{library_name}.so.6"
        if candidate.exists():
            return candidate
    raise RuntimeError(f"could not find system {library_name}.so.6")


def build_local_ncurses(cache_dir, build_dir):
    archive = download_ncurses(cache_dir)
    deps_root = build_dir / "deps-src"
    deps_root.mkdir(parents=True, exist_ok=True)
    ncurses_root = deps_root / NCURSES_DIR
    if ncurses_root.exists():
        shutil.rmtree(ncurses_root)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(deps_root)
    prefix = build_dir / "deps" / "ncurses"
    run(
        [
            "./configure",
            f"--prefix={prefix}",
            "--without-shared",
            "--with-normal",
            "--without-debug",
            "--without-ada",
            "--without-manpages",
            "--without-progs",
        ],
        cwd=ncurses_root,
    )
    run(["make", "-j2", "install.includes"], cwd=ncurses_root)
    lib_dir = prefix / "lib"
    lib_dir.mkdir(parents=True, exist_ok=True)
    for library_name in ("libncurses", "libtinfo"):
        link = lib_dir / f"{library_name}.so"
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(system_library_path(library_name))
    return prefix


def less_build_env(ncurses_prefix=None):
    env = os.environ.copy()
    env["CFLAGS"] = "-g -O0 -fno-omit-frame-pointer"
    env["LDFLAGS"] = "-Wl,--build-id"
    if ncurses_prefix is not None:
        env["CPPFLAGS"] = f"-I{ncurses_prefix / 'include'}"
        env["LDFLAGS"] = f"-L{ncurses_prefix / 'lib'} -Wl,--build-id"
    return env


def configure_less(source_root, prefix, env):
    run(["./configure", f"--prefix={prefix}"], cwd=source_root, env=env)


def build_less(source_root, prefix, cache_dir, build_dir):
    dependency_report = {"localNcursesBuilt": False}
    try:
        configure_less(source_root, prefix, less_build_env())
    except RuntimeError as error:
        if "Cannot find terminal libraries" not in str(error):
            raise
        ncurses_prefix = build_local_ncurses(cache_dir, build_dir)
        dependency_report = {
            "localNcursesHeadersBuilt": True,
            "localNcursesBuilt": False,
            "source": {"url": NCURSES_URL, "sha256": NCURSES_SHA256, "directory": NCURSES_DIR},
            "prefix": str(ncurses_prefix),
            "dynamicSystemLibraries": [str(system_library_path("libncurses")), str(system_library_path("libtinfo"))],
        }
        configure_less(source_root, prefix, less_build_env(ncurses_prefix))
    run(["make", "-j2", "less"], cwd=source_root)
    bin_dir = prefix / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    binary = bin_dir / "less"
    shutil.copy2(source_root / "less", binary)
    binary.chmod(0o755)
    return binary, dependency_report


def command_or_empty(command):
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    return result.stdout.strip(), result.stderr.strip(), result.returncode


def symbol_lines(binary):
    stdout, stderr, code = command_or_empty(["nm", "-an", str(binary)])
    if code != 0:
        return {"available": False, "error": stderr}
    return {
        "available": True,
        "lines": [line for line in stdout.splitlines() if "machinen_less" in line],
    }


def build_id(binary):
    stdout, stderr, code = command_or_empty(["readelf", "-n", str(binary)])
    if code != 0:
        return {"available": False, "error": stderr}
    line = next((line.strip() for line in stdout.splitlines() if "Build ID:" in line), None)
    return {"available": line is not None, "line": line}


def main():
    if len(sys.argv) != 3:
        print("usage: known_less_builder.py <build-dir> <retained-dir>", file=sys.stderr)
        return 2
    build_dir = Path(sys.argv[1])
    retained_dir = Path(sys.argv[2])
    cache_dir = build_dir / "cache"
    source_build_dir = build_dir / "src"
    prefix = build_dir / "prefix"
    retained_dir.mkdir(parents=True, exist_ok=True)
    build_dir.mkdir(parents=True, exist_ok=True)
    archive = download_source(cache_dir)
    source_build_dir.mkdir(parents=True, exist_ok=True)
    source_root = extract_source(archive, source_build_dir)
    patch_command_c(source_root)
    binary, dependency_report = build_less(source_root, prefix, cache_dir, build_dir)
    version = run([str(binary), "--version"]).splitlines()[0]
    symbols = symbol_lines(binary)
    report = {
        "kind": "machinen.research.real-less-detector.known-less-build",
        "version": 1,
        "source": {
            "url": SOURCE_URL,
            "sha256": SOURCE_SHA256,
            "directory": SOURCE_DIR,
        },
        "binary": {
            "path": str(binary),
            "sha256": sha256(binary),
            "versionLine": version,
            "buildId": build_id(binary),
        },
        "build": {
            "cflags": "-g -O0 -fno-omit-frame-pointer",
            "ldflags": "-Wl,--build-id",
            "debugSymbolsRequired": True,
            "markerSymbolsRequired": [MARKER_SYMBOL, GATE_SYMBOL],
            "dependencies": dependency_report,
        },
        "marker": {
            "symbol": MARKER_SYMBOL,
            "gateSymbol": GATE_SYMBOL,
            "environment": "MACHINEN_LESS_SPIN_AT_READY=1",
            "location": "command loop after prompt rendering and before getcc/read input",
            "behavior": "spins in target-native less code at a source-level safe point for detector evidence only",
            "symbols": symbols,
        },
        "status": "passed" if symbols.get("available") and len(symbols.get("lines", [])) >= 2 else "failed",
    }
    if report["status"] != "passed":
        raise RuntimeError(f"marker symbols missing from built less: {symbols}")
    (retained_dir / "known-less-build.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
