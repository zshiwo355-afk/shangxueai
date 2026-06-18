"""纯 Python 实现 MP4 faststart：把 moov 原子移动到文件头部。

浏览器/微信内核播放 MP4 前必须先读到 moov（索引）。很多录屏/导出工具（如 QQ 录屏）
生成的 mp4 把 moov 放在文件末尾，导致微信 X5 内核做 Range 分段加载时迟迟读不到
moov，一直卡在“正在加载视频...”。本模块把 moov 前移并修正 stco/co64 中的绝对偏移，
等价于 `ffmpeg -movflags +faststart`，但不依赖任何外部进程。

仅处理标准未压缩 moov；遇到压缩 moov(cmov) 或结构异常时抛 FaststartError，调用方应跳过。
"""
from __future__ import annotations

import struct
from typing import NamedTuple


class FaststartError(Exception):
    """faststart 处理无法安全完成（结构异常 / 压缩 moov 等）。"""


class _Atom(NamedTuple):
    type: str
    offset: int  # 该 atom 头部起始绝对偏移
    header_size: int  # 8 或 16（64 位 size）
    size: int  # 包含头部的总字节数


def _read_atoms(data: bytes, start: int, end: int) -> list[_Atom]:
    atoms: list[_Atom] = []
    pos = start
    while pos + 8 <= end:
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8].decode("latin1", "replace")
        header = 8
        if size == 1:
            if pos + 16 > end:
                break
            size = struct.unpack(">Q", data[pos + 8:pos + 16])[0]
            header = 16
        elif size == 0:
            size = end - pos  # 延伸到末尾
        if size < header or pos + size > end:
            break
        atoms.append(_Atom(typ, pos, header, size))
        pos += size
    return atoms


def _patch_chunk_offsets(moov: bytearray, delta: int) -> None:
    """递归遍历 moov，给所有 stco(32位)/co64(64位) 的块偏移加上 delta。"""

    def walk(start: int, end: int) -> None:
        pos = start
        while pos + 8 <= end:
            size = struct.unpack(">I", moov[pos:pos + 4])[0]
            typ = moov[pos + 4:pos + 8].decode("latin1", "replace")
            header = 8
            if size == 1:
                size = struct.unpack(">Q", moov[pos + 8:pos + 16])[0]
                header = 16
            elif size == 0:
                size = end - pos
            if size < header or pos + size > end:
                raise FaststartError("moov 内部 box 结构异常。")
            body = pos + header
            if typ == "stco":
                count = struct.unpack(">I", moov[body + 4:body + 8])[0]
                base = body + 8
                for i in range(count):
                    off = base + i * 4
                    val = struct.unpack(">I", moov[off:off + 4])[0]
                    struct.pack_into(">I", moov, off, (val + delta) & 0xFFFFFFFF)
            elif typ == "co64":
                count = struct.unpack(">I", moov[body + 4:body + 8])[0]
                base = body + 8
                for i in range(count):
                    off = base + i * 8
                    val = struct.unpack(">Q", moov[off:off + 8])[0]
                    struct.pack_into(">Q", moov, off, val + delta)
            elif typ in _CONTAINER_BOXES:
                walk(body, pos + size)
            pos += size

    walk(0, len(moov))


# 含子 box、需要递归进入的容器类型（stco/co64 嵌在 stbl 里）。
_CONTAINER_BOXES = {"moov", "trak", "mdia", "minf", "stbl", "edts", "mdia", "udta"}


def needs_faststart(data: bytes) -> bool:
    """moov 是否排在 mdat 之后（即需要 faststart）。"""
    atoms = _read_atoms(data, 0, len(data))
    types = [a.type for a in atoms]
    if "moov" not in types or "mdat" not in types:
        return False
    return types.index("moov") > types.index("mdat")


def faststart_bytes(data: bytes) -> bytes:
    """返回 moov 前置后的新字节；若无需处理则原样返回。"""
    atoms = _read_atoms(data, 0, len(data))
    by_type = {a.type: a for a in atoms}
    if "moov" not in by_type or "mdat" not in by_type:
        return data
    moov = by_type["moov"]
    mdat = by_type["mdat"]
    if moov.offset < mdat.offset:
        return data  # 已经前置

    moov_bytes = bytearray(data[moov.offset:moov.offset + moov.size])
    # 检测压缩 moov（cmov），无法简单处理。
    if b"cmov" in moov_bytes:
        raise FaststartError("压缩 moov(cmov) 不支持 faststart。")

    # 把 moov 从尾部移到 ftyp 之后，mdat 等数据整体后移 moov.size，
    # 因此 stco/co64 中指向 mdat 的绝对偏移都要 + moov.size。
    _patch_chunk_offsets(moov_bytes, moov.size)

    # 找插入点：第一个非 ftyp 的 atom 之前（通常紧跟 ftyp）。
    insert_at = 0
    for a in atoms:
        if a.type == "ftyp":
            insert_at = a.offset + a.size
            break

    # 原数据中去掉 moov 段。
    without_moov = data[:moov.offset] + data[moov.offset + moov.size:]
    # moov.offset 在 insert_at 之后，删除不影响 insert_at。
    return without_moov[:insert_at] + bytes(moov_bytes) + without_moov[insert_at:]


# ---- 流式 faststart：用于超大文件（GB 级），不把整个文件读进内存 ----

class FaststartPlan(NamedTuple):
    """流式 faststart 重组计划。新文件 = 头部 segments 拼接，全部用 OSS 服务端拷贝/上传完成。

    segments: 有序的片段列表，每项是 ("copy", src_start, src_end) 表示从源对象拷贝
    [src_start, src_end) 字节，或 ("data", bytes) 表示上传内存中的字节（即修正后的 moov + ftyp）。
    """
    segments: list
    total_size: int


def _scan_atoms_via_reader(read_range, file_size: int) -> list[_Atom]:
    """通过 Range 读取逐个解析顶层 atom 的头部，不下载 mdat body。

    read_range(start, length) -> bytes：调用方提供的按需读取函数。
    """
    atoms: list[_Atom] = []
    pos = 0
    while pos + 8 <= file_size:
        header = read_range(pos, 16)  # 最多需要 16 字节（64 位 size）
        if len(header) < 8:
            break
        size = struct.unpack(">I", header[:4])[0]
        typ = header[4:8].decode("latin1", "replace")
        header_size = 8
        if size == 1:
            if len(header) < 16:
                break
            size = struct.unpack(">Q", header[8:16])[0]
            header_size = 16
        elif size == 0:
            size = file_size - pos
        if size < header_size or pos + size > file_size:
            raise FaststartError("顶层 box 结构异常或越界。")
        atoms.append(_Atom(typ, pos, header_size, size))
        pos += size
    return atoms


def plan_faststart_streaming(read_range, file_size: int) -> FaststartPlan | None:
    """为超大 mp4 生成流式 faststart 计划，仅下载 moov 段到内存。

    read_range(start, length) -> bytes：按需 Range 读取源对象。
    返回 None 表示无需处理（moov 已前置 / 非标准结构跳过）。
    """
    atoms = _scan_atoms_via_reader(read_range, file_size)
    by_type = {a.type: a for a in atoms}
    if "moov" not in by_type or "mdat" not in by_type:
        return None
    moov = by_type["moov"]
    mdat = by_type["mdat"]
    if moov.offset < mdat.offset:
        return None  # 已前置

    # 只下载 moov 段（通常几 MB）。
    moov_bytes = bytearray(read_range(moov.offset, moov.size))
    if len(moov_bytes) != moov.size:
        raise FaststartError("moov 段读取不完整。")
    if b"cmov" in moov_bytes:
        raise FaststartError("压缩 moov(cmov) 不支持 faststart。")
    _patch_chunk_offsets(moov_bytes, moov.size)

    # 插入点：ftyp 之后。
    insert_at = 0
    for a in atoms:
        if a.type == "ftyp":
            insert_at = a.offset + a.size
            break

    # 新文件布局： [0, insert_at)头部(ftyp等) + 修正后moov + [insert_at, moov.offset) + [moov后, end)
    # OSS 分片拷贝要求：除最后一片外每片 ≥100KB。头部(ftyp 仅几十字节)太小不能单独 copy，
    # 故把头部下载进内存、与 moov 合并成第一个 data part（几 MB，达标）。
    head_bytes = b""
    if insert_at > 0:
        head_bytes = read_range(0, insert_at)
        if len(head_bytes) != insert_at:
            raise FaststartError("头部读取不完整。")
    first_part = bytes(head_bytes) + bytes(moov_bytes)

    moov_end = moov.offset + moov.size
    mid_start = insert_at      # 中间体（mdat 等）起点
    mid_end = moov.offset      # 中间体终点

    # OSS 分片拷贝要求：除最后一片外每片 ≥100KB。若 first_part 太小（moov 很小），
    # 从中间体头部补读字节并进内存，使第一片达标；相应抬高中间体 copy 起点。
    _MIN_PART = 100 * 1024
    _PAD_TO = 256 * 1024
    if len(first_part) < _MIN_PART and mid_end > mid_start:
        need = min(_PAD_TO - len(first_part), mid_end - mid_start)
        if need > 0:
            pad = read_range(mid_start, need)
            if len(pad) != need:
                raise FaststartError("补足头部读取不完整。")
            first_part = first_part + bytes(pad)
            mid_start += need

    segments: list = [("data", first_part)]
    if mid_end > mid_start:
        segments.append(("copy", mid_start, mid_end))
    if moov_end < file_size:
        segments.append(("copy", moov_end, file_size))
    return FaststartPlan(segments=segments, total_size=file_size)
