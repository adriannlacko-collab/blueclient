"""Swap a handful of .class entries in a jar without touching any other entry.

Every entry that is not replaced keeps its compressed bytes exactly as they
were (the same approach as launcher/src/main/game/jar.js): its data is copied
verbatim and only the headers around it are rewritten, with the
data-descriptor bit cleared because the sizes are now known up front.
Replaced entries keep their position; brand-new entries (a nested class the
patched source needs that the original did not have) go right after their
outer class. Nested classes of a patched outer class that the new compile no
longer produces are dropped, since they belong to the old outer class.
"""

import struct
import zlib

LOCAL_SIG = 0x04034B50
CENTRAL_SIG = 0x02014B50
END_SIG = 0x06054B50
DESCRIPTOR_BIT = 0x0008
DOS_TIME = 0x0000          # 00:00:00
DOS_DATE = 0x0021          # 1980-01-01, what the Gradle build stamps every entry with


class Entry:
    __slots__ = ("name", "flags", "method", "time", "date", "crc", "csize", "usize",
                 "extra", "comment", "internal", "external", "version_made", "version_needed", "data")


def read(path):
    buf = open(path, "rb").read()
    end = buf.rfind(struct.pack("<I", END_SIG), max(0, len(buf) - 65557))
    if end < 0:
        raise ValueError(f"{path}: not a zip")
    (_, _, _, _, count, _, cd_offset, _) = struct.unpack_from("<IHHHHIIH", buf, end)
    entries = []
    at = cd_offset
    for _ in range(count):
        (sig, made, needed, flags, method, time, date, crc, csize, usize, nlen, xlen, clen,
         _disk, internal, external, local) = struct.unpack_from("<IHHHHHHIIIHHHHHII", buf, at)
        if sig != CENTRAL_SIG:
            raise ValueError("bad central directory")
        if csize == 0xFFFFFFFF or usize == 0xFFFFFFFF or local == 0xFFFFFFFF:
            raise ValueError("zip64 is not supported")
        e = Entry()
        e.name = buf[at + 46: at + 46 + nlen].decode("utf-8")
        e.extra = buf[at + 46 + nlen: at + 46 + nlen + xlen]
        e.comment = buf[at + 46 + nlen + xlen: at + 46 + nlen + xlen + clen]
        e.version_made, e.version_needed, e.flags, e.method = made, needed, flags, method
        e.time, e.date, e.crc, e.csize, e.usize = time, date, crc, csize, usize
        e.internal, e.external = internal, external
        (lsig,) = struct.unpack_from("<I", buf, local)
        if lsig != LOCAL_SIG:
            raise ValueError("bad local header")
        lnlen, lxlen = struct.unpack_from("<HH", buf, local + 26)
        start = local + 30 + lnlen + lxlen
        e.data = buf[start: start + csize]
        entries.append(e)
        at += 46 + nlen + xlen + clen
    return entries


def _fresh(name, raw):
    comp = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = comp.compress(raw) + comp.flush()
    e = Entry()
    e.name = name
    e.flags = 0x0800 if any(ord(c) > 127 for c in name) else 0
    e.method = 8
    e.time, e.date = DOS_TIME, DOS_DATE
    e.crc = zlib.crc32(raw) & 0xFFFFFFFF
    e.csize, e.usize = len(packed), len(raw)
    e.extra = b""
    e.comment = b""
    e.internal, e.external = 0, 0
    e.version_made, e.version_needed = 20, 20
    e.data = packed
    return e


def write(path, entries):
    out = bytearray()
    central = bytearray()
    for e in entries:
        flags = e.flags & ~DESCRIPTOR_BIT
        name = e.name.encode("utf-8")
        offset = len(out)
        out += struct.pack("<IHHHHHIIIHH", LOCAL_SIG, e.version_needed, flags, e.method, e.time, e.date,
                           e.crc, e.csize, e.usize, len(name), 0)
        out += name
        out += e.data
        central += struct.pack("<IHHHHHHIIIHHHHHII", CENTRAL_SIG, e.version_made, e.version_needed, flags,
                               e.method, e.time, e.date, e.crc, e.csize, e.usize, len(name), len(e.extra),
                               len(e.comment), 0, e.internal, e.external, offset)
        central += name + e.extra + e.comment
    cd_offset = len(out)
    out += central
    out += struct.pack("<IHHHHIIH", END_SIG, 0, 0, len(entries), len(entries), len(central), cd_offset, 0)
    with open(path, "wb") as f:
        f.write(out)


def outer_of(name):
    """com/x/Foo$Bar$1.class -> com/x/Foo"""
    base = name[:-len(".class")]
    return base.split("$", 1)[0]


def patch(original, output, classes):
    """classes: {entry name: bytes} for every class file the patched sources compiled to."""
    entries = read(original)
    outers = {outer_of(n) for n in classes}
    placed = set()
    result = []
    report = {"replaced": [], "added": [], "dropped": []}
    by_outer_new = {}
    for n in classes:
        by_outer_new.setdefault(outer_of(n), []).append(n)

    for e in entries:
        if e.name.endswith(".class") and outer_of(e.name) in outers:
            if e.name in classes:
                result.append(_fresh(e.name, classes[e.name]))
                placed.add(e.name)
                report["replaced"].append(e.name)
            else:
                report["dropped"].append(e.name)
            # new nested classes go right after their outer class
            if e.name == outer_of(e.name) + ".class":
                for n in sorted(by_outer_new[outer_of(e.name)]):
                    if n not in placed and not any(x.name == n for x in entries):
                        result.append(_fresh(n, classes[n]))
                        placed.add(n)
                        report["added"].append(n)
            continue
        result.append(e)
    missing = [n for n in classes if n not in placed]
    if missing:
        raise ValueError(f"patched classes whose outer class is not in the jar: {missing}")
    write(output, result)
    return report
