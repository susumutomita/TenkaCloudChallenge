"""Kernel-enforced network denial for learner processes, using the pinned image's libseccomp.

This is an additional process restriction, not a replacement for container isolation.
Filters survive exec/fork. A missing library or failed filter aborts execution.
"""
import ctypes
import errno
import sys


def protect_supervisor():
    """Disallow same-UID child access to the supervisor's /proc memory and descriptors."""
    if sys.platform != 'linux':
        raise RuntimeError('participant runtime requires Linux process isolation')
    libc=ctypes.CDLL(None, use_errno=True)
    if libc.prctl(4, 0, 0, 0, 0) != 0:  # PR_SET_DUMPABLE
        raise OSError(ctypes.get_errno(), 'could not protect supervisor')


def block_network():
    if sys.platform != 'linux':
        raise RuntimeError('learner execution requires Linux seccomp')
    lib=ctypes.CDLL('libseccomp.so.2', use_errno=True)
    lib.seccomp_init.argtypes=[ctypes.c_uint32]
    lib.seccomp_init.restype=ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype=ctypes.c_int
    lib.seccomp_rule_add.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint]
    lib.seccomp_rule_add.restype=ctypes.c_int
    lib.seccomp_load.argtypes=[ctypes.c_void_p]
    lib.seccomp_load.restype=ctypes.c_int
    lib.seccomp_release.argtypes=[ctypes.c_void_p]
    lib.seccomp_release.restype=None
    context=lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW; libseccomp guards the native ABI
    if not context:
        raise RuntimeError('could not create seccomp context')
    try:
        # Close inherited descriptors in the launcher, then forbid network creation,
        # transfers and alternate routes through io_uring or another process's FDs.
        blocked=('socket','socketpair','connect','bind','listen','accept','accept4',
                 'sendto','sendmsg','sendmmsg','recvfrom','recvmsg','recvmmsg',
                 'socketcall','io_uring_setup','pidfd_getfd','ptrace',
                 'process_vm_readv','process_vm_writev')
        for name in blocked:
            number=lib.seccomp_syscall_resolve_name(name.encode())
            if number < 0:
                if name in ('socket','connect'):
                    raise RuntimeError('required network syscall unavailable')
                continue  # syscall does not exist in the native ABI
            result=lib.seccomp_rule_add(context,0x00050000 | errno.EPERM,number,0)
            if result != 0:
                raise RuntimeError(f'could not deny syscall {name}: {result}')
        result=lib.seccomp_load(context)
        if result != 0:
            raise RuntimeError(f'could not install network filter: {result}')
    finally:
        lib.seccomp_release(context)
