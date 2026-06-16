# Rootdisk environment benchmark: disk vs ramdisk

KVM/amd64 `pnpm bench --suite all --guest-arch amd64 --n 5` comparison for the rootdisk benchmark optimization branch.

## Artifacts

- Disk JSON: `rootdisk-env-disk-all-2026-06-16T20-34-46Z.json`
- Ramdisk JSON: `rootdisk-env-ramdisk-all-2026-06-16T20-45-36Z.json`
- Disk runtime: 538.84s
- Ramdisk runtime: 308.42s

Both runs record `git.dirty=true` because they were captured from the working tree before committing these benchmark changes.

## Environment

- disk: config.environment=`disk`, filesystems={'repo': 'ext4', 'tmp': 'ext4', 'assets': 'ext4', 'rootfs_img_cache': 'ext4', 'benchmark_output': 'ext4'}
- ramdisk: config.environment=`ramdisk`, filesystems={'repo': 'tmpfs', 'tmp': 'tmpfs', 'assets': 'tmpfs', 'rootfs_img_cache': 'tmpfs', 'benchmark_output': 'tmpfs'}

## p50 / p95

| metric                        |             disk med / p95 |        ramdisk med / p95 |
| ----------------------------- | -------------------------: | -----------------------: |
| boot cold total ms            |             15163 / 106197 |              6618 / 6851 |
| boot cold rootdisk copy ms    |               7362 / 92953 |                468 / 511 |
| boot cold rootdisk phase ms   |             15116 / 106151 |              6580 / 6808 |
| boot cold gunzip prebake ms   |                6222 / 7686 |              6090 / 6273 |
| boot warm total ms            |               1206 / 22324 |                438 / 487 |
| boot warm rootdisk copy ms    |               1119 / 22137 |                370 / 412 |
| snapshot wall ms              | 6116.397201 / 15392.959074 | 3860.948286 / 5308.31309 |
| restore cold total ms         |               6304 / 12185 |              1947 / 2098 |
| restore cold rootdisk copy ms |               4540 / 10171 |                466 / 526 |
| restore warm total ms         |               3010 / 14639 |              1976 / 1979 |
| restore warm rootdisk copy ms |               1283 / 12948 |                477 / 489 |
| mount vm boot ms              |                1104 / 1951 |                513 / 533 |
| mount extract wall ms         |               9824 / 10071 |              9071 / 9074 |
| net latency us/ping           |                   79 / 105 |                 87 / 109 |
| net rx MB/s                   |                  274 / 343 |                280 / 342 |
| net tx MB/s                   |                  305 / 309 |                292 / 300 |

## Notes

- Both environments still report rootdisk copies as fallback `copy`/`node-copy` with `ENOTSUP`; tmpfs removes block-device IO but does not make these rootdisk copies true CoW reflinks.
- Ramdisk collapses rootdisk copy tail latency: cold rootdisk copy p95 changes from 92953ms on disk to 511ms on ramdisk.
- Cold boot on ramdisk is still dominated by `rootdisk-materialize.gunzip-prebake` at 6090ms median / 6273ms p95.
