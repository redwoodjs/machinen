import hashlib, http.client, json, os, pathlib, platform, sqlite3, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

out = pathlib.Path(os.environ["OUT_DIR"])
bundle = out / "bundle"
root = bundle / "filesystem" / "root"
port = int(os.environ["SERVICE_PORT"])
target_arch = os.environ["TARGET_ARCH"]
source_arch = os.environ["SOURCE_ARCH"]
for path in [root / "etc" / "machinen", root / "var" / "lib" / "machinen" / "data"]:
    path.mkdir(parents=True, exist_ok=True)
(root / "etc" / "machinen" / "message.txt").write_text("portable filesystem alpha\n", encoding="utf8")
(root / "var" / "lib" / "machinen" / "data" / "numbers.txt").write_text("1\n2\n3\n", encoding="utf8")

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

files = []
for path in sorted(root.rglob("*")):
    if path.is_file():
        rel = path.relative_to(root).as_posix()
        files.append({"path": rel, "bytes": path.stat().st_size, "sha256": sha256_file(path)})
fs_manifest = {"kind": "machinen.portable-vm-filesystem-capture", "version": 1, "root": "filesystem/root", "files": files}
(bundle / "filesystem-manifest.json").write_text(json.dumps(fs_manifest, indent=2) + "\n", encoding="utf8")

sqlite_rows = [(1, "alpha", 11), (2, "beta", 13), (3, "gamma", 17)]
with tempfile.TemporaryDirectory() as tmp:
    db_path = pathlib.Path(tmp) / "source.db"
    con = sqlite3.connect(db_path)
    con.execute("create table items(id integer primary key, name text not null, qty integer not null)")
    con.executemany("insert into items(id, name, qty) values (?, ?, ?)", sqlite_rows)
    con.commit()
    count, total = con.execute("select count(*), sum(qty) from items").fetchone()
    dump = list(con.iterdump())
    con.close()
sqlite_manifest = {
    "kind": "machinen.portable-vm-sqlite-logical-capture",
    "version": 1,
    "database": "app.db",
    "engine": "sqlite",
    "state": "clean-quiesced",
    "dumpPath": "sqlite-dump.sql",
    "expected": {"count": count, "qtySum": total},
}
(bundle / "sqlite-logical.json").write_text(json.dumps(sqlite_manifest, indent=2) + "\n", encoding="utf8")
(bundle / "sqlite-dump.sql").write_text("\n".join(dump) + "\n", encoding="utf8")
(bundle / "sqlite-expected.env").write_text(f"COUNT={count}\nQTY_SUM={total}\n", encoding="utf8")

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"machinen-portable-service-v1\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_args):
        return

server = HTTPServer(("127.0.0.1", port), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
conn.request("GET", "/")
resp = conn.getresponse()
service_body = resp.read().decode("utf8").strip()
conn.close()
server.shutdown()
thread.join(timeout=5)
service_manifest = {
    "kind": "machinen.portable-vm-service-capture",
    "version": 1,
    "serviceId": "selected-python-http-service",
    "runtime": "python3-target-native",
    "bindAddress": "127.0.0.1",
    "port": port,
    "path": "/",
    "expectedResponse": service_body,
    "sourceVerifier": {"status": resp.status, "body": service_body},
}
(bundle / "service-manifest.json").write_text(json.dumps(service_manifest, indent=2) + "\n", encoding="utf8")
(bundle / "service-expected-response.txt").write_text(service_body + "\n", encoding="utf8")
(bundle / "filesystem-sha256.txt").write_text("".join(f"{row['sha256']}  {row['path']}\n" for row in files), encoding="utf8")
manifest = {
    "kind": "machinen.real-cross-arch-portable-vm-all3-bundle",
    "version": 1,
    "scope": "real-cross-arch-portable-vm-filesystem-service-sqlite-v1",
    "source": {"architecture": source_arch, "platformMachine": platform.machine()},
    "target": {"architecture": target_arch},
    "workloads": ["filesystem", "service", "sqlite"],
    "claimGuard": {
        "arbitraryVmRestoreClaimed": False,
        "rawVmStateReplayUsed": False,
        "sourceIsaEmulationUsed": False,
        "metadataOnlyShortcutAccepted": False,
    },
}
(bundle / "portable-vm-all3-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
transcript = {
    "kind": "machinen.real-cross-arch-portable-vm-all3-source-transcript",
    "version": 1,
    "accepted": True,
    "sourceArch": source_arch,
    "targetArch": target_arch,
    "filesystemFiles": len(files),
    "sqliteExpected": sqlite_manifest["expected"],
    "serviceExpectedResponse": service_body,
}
(out / "source-capture-transcript.json").write_text(json.dumps(transcript, indent=2) + "\n", encoding="utf8")
print(json.dumps(transcript, indent=2))
