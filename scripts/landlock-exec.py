#!/usr/bin/env python3
import ctypes
import os
import sys

SYS_LANDLOCK_CREATE_RULESET = 444
SYS_LANDLOCK_ADD_RULE = 445
SYS_LANDLOCK_RESTRICT_SELF = 446
LANDLOCK_CREATE_RULESET_VERSION = 1
LANDLOCK_RULE_PATH_BENEATH = 1
LANDLOCK_RULE_NET_PORT = 2
PR_SET_NO_NEW_PRIVS = 38

FS_EXECUTE = 1 << 0
FS_WRITE_FILE = 1 << 1
FS_READ_FILE = 1 << 2
FS_READ_DIR = 1 << 3
FS_REFER = 1 << 13
FS_TRUNCATE = 1 << 14
FS_IOCTL_DEV = 1 << 15
NET_CONNECT_TCP = 1 << 1
SCOPE_ABSTRACT_UNIX_SOCKET = 1 << 0
SCOPE_SIGNAL = 1 << 1

FILE_ACCESS = FS_EXECUTE | FS_WRITE_FILE | FS_READ_FILE | FS_TRUNCATE | FS_IOCTL_DEV
READ_ACCESS = FS_EXECUTE | FS_READ_FILE | FS_READ_DIR


class RulesetAttr(ctypes.Structure):
    _fields_ = [
        ("handled_access_fs", ctypes.c_uint64),
        ("handled_access_net", ctypes.c_uint64),
        ("scoped", ctypes.c_uint64),
    ]


class PathBeneathAttr(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32)]


class NetPortAttr(ctypes.Structure):
    _fields_ = [("allowed_access", ctypes.c_uint64), ("port", ctypes.c_uint64)]


libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long


def fail(message):
    sys.stderr.write(f"landlock-exec: {message}\n")
    sys.exit(126)


def landlock_abi():
    if not sys.platform.startswith("linux"):
        return 0
    version = libc.syscall(
        ctypes.c_long(SYS_LANDLOCK_CREATE_RULESET),
        ctypes.c_void_p(None),
        ctypes.c_size_t(0),
        ctypes.c_uint32(LANDLOCK_CREATE_RULESET_VERSION),
    )
    return max(0, version)


def fs_access(abi):
    access = (1 << 13) - 1
    if abi >= 2:
        access |= FS_REFER
    if abi >= 3:
        access |= FS_TRUNCATE
    if abi >= 5:
        access |= FS_IOCTL_DEV
    return access


def parse(argv):
    rules = {"--ro": [], "--rw": [], "--dev": [], "--connect": []}
    index = 0
    while index < len(argv) and argv[index] != "--":
        flag = argv[index]
        if flag not in rules or index + 1 >= len(argv):
            fail(f"unexpected argument {flag}")
        rules[flag].append(argv[index + 1])
        index += 2
    command = argv[index + 1:]
    if not command:
        fail("missing command")
    return rules, command


def add_path(ruleset_fd, path, access):
    try:
        fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
    except FileNotFoundError:
        return
    try:
        if not os.path.isdir(path):
            access &= FILE_ACCESS
        rule = PathBeneathAttr(access, fd)
        if libc.syscall(
            ctypes.c_long(SYS_LANDLOCK_ADD_RULE),
            ctypes.c_int(ruleset_fd),
            ctypes.c_int(LANDLOCK_RULE_PATH_BENEATH),
            ctypes.byref(rule),
            ctypes.c_uint32(0),
        ) != 0:
            fail(f"cannot allow {path}: {os.strerror(ctypes.get_errno())}")
    finally:
        os.close(fd)


def add_port(ruleset_fd, port):
    rule = NetPortAttr(NET_CONNECT_TCP, int(port))
    if libc.syscall(
        ctypes.c_long(SYS_LANDLOCK_ADD_RULE),
        ctypes.c_int(ruleset_fd),
        ctypes.c_int(LANDLOCK_RULE_NET_PORT),
        ctypes.byref(rule),
        ctypes.c_uint32(0),
    ) != 0:
        fail(f"cannot allow port {port}: {os.strerror(ctypes.get_errno())}")


def main(argv):
    if argv == ["--probe"]:
        print(landlock_abi())
        return
    rules, command = parse(argv)
    abi = landlock_abi()
    if abi < 1:
        fail("Landlock is not available on this kernel")

    handled_fs = fs_access(abi)
    restrict_net = abi >= 4 and bool(rules["--connect"])
    attr = RulesetAttr(
        handled_fs,
        NET_CONNECT_TCP if restrict_net else 0,
        SCOPE_ABSTRACT_UNIX_SOCKET | SCOPE_SIGNAL if abi >= 6 else 0,
    )
    size = 24 if abi >= 6 else 16 if abi >= 4 else 8
    ruleset_fd = libc.syscall(
        ctypes.c_long(SYS_LANDLOCK_CREATE_RULESET),
        ctypes.byref(attr),
        ctypes.c_size_t(size),
        ctypes.c_uint32(0),
    )
    if ruleset_fd < 0:
        fail(f"cannot create a ruleset: {os.strerror(ctypes.get_errno())}")

    for path in rules["--ro"]:
        add_path(ruleset_fd, path, READ_ACCESS)
    for path in rules["--rw"]:
        add_path(ruleset_fd, path, handled_fs)
    for path in rules["--dev"]:
        add_path(ruleset_fd, path, READ_ACCESS | FS_WRITE_FILE | (handled_fs & (FS_TRUNCATE | FS_IOCTL_DEV)))
    if restrict_net:
        for port in rules["--connect"]:
            add_port(ruleset_fd, port)

    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        fail("cannot set no_new_privs")
    if libc.syscall(ctypes.c_long(SYS_LANDLOCK_RESTRICT_SELF), ctypes.c_int(ruleset_fd), ctypes.c_uint32(0)) != 0:
        fail(f"cannot restrict itself: {os.strerror(ctypes.get_errno())}")
    os.close(ruleset_fd)

    try:
        os.execvp(command[0], command)
    except OSError as error:
        fail(f"cannot run {command[0]}: {error.strerror}")


if __name__ == "__main__":
    main(sys.argv[1:])
