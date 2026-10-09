#!/usr/bin/env python3
import errno
import os
import sys

BLOCKED_SYSCALLS = [
    "_sysctl",
    "acct",
    "add_key",
    "bpf",
    "clock_adjtime",
    "clock_settime",
    "create_module",
    "delete_module",
    "finit_module",
    "fsconfig",
    "fsmount",
    "fsopen",
    "fspick",
    "get_kernel_syms",
    "init_module",
    "io_uring_enter",
    "io_uring_register",
    "io_uring_setup",
    "ioperm",
    "iopl",
    "kexec_file_load",
    "kexec_load",
    "keyctl",
    "lookup_dcookie",
    "mount",
    "mount_setattr",
    "move_mount",
    "name_to_handle_at",
    "nfsservctl",
    "open_by_handle_at",
    "open_tree",
    "perf_event_open",
    "pivot_root",
    "query_module",
    "quotactl",
    "quotactl_fd",
    "reboot",
    "request_key",
    "setns",
    "settimeofday",
    "stime",
    "swapoff",
    "swapon",
    "sysfs",
    "syslog",
    "umount",
    "umount2",
    "unshare",
    "uselib",
    "userfaultfd",
    "ustat",
    "vhangup",
    "vm86",
    "vm86old",
]
CLONE_NAMESPACE_FLAGS = [0x00020000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000]
UNKNOWN_SYSCALL = -1


def fail(message):
    sys.stderr.write(f"seccomp-exec: {message}\n")
    sys.exit(126)


def main(argv):
    if len(argv) < 2 or argv[0] != "--":
        fail("usage: seccomp-exec.py -- command [args...]")
    try:
        import seccomp
    except ImportError:
        fail("the python3-seccomp package is not installed")

    deny = seccomp.ERRNO(errno.EPERM)
    syscall_filter = seccomp.SyscallFilter(seccomp.ALLOW)
    arch = seccomp.Arch.NATIVE
    for name in BLOCKED_SYSCALLS:
        number = seccomp.resolve_syscall(arch, name)
        if number == UNKNOWN_SYSCALL:
            fail(f"unknown system call {name}")
        if number >= 0:
            syscall_filter.add_rule(deny, number)
    for flag in CLONE_NAMESPACE_FLAGS:
        syscall_filter.add_rule(deny, "clone", seccomp.Arg(0, seccomp.MASKED_EQ, flag, flag))
    syscall_filter.add_rule(seccomp.ERRNO(errno.ENOSYS), "clone3")
    syscall_filter.load()

    try:
        os.execvp(argv[1], argv[1:])
    except OSError as error:
        fail(f"cannot run {argv[1]}: {error.strerror}")


if __name__ == "__main__":
    main(sys.argv[1:])
