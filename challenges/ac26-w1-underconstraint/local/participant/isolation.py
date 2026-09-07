"""Problem-local restrictions installed after reading sources and inputs, before learner code.

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


def restrict_learner():
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
        # After inputs and libraries are loaded, forbid opening files or new programs,
        # as well as network creation,
        # transfers and alternate routes through io_uring or another process's FDs.
        blocked=('socket','socketpair','connect','bind','listen','accept','accept4',
                 'sendto','sendmsg','sendmmsg','recvfrom','recvmsg','recvmmsg',
                 'open','openat','openat2','creat','open_by_handle_at','execve','execveat',
                 # Metadata operations need no open FD and can persist in shared /tmp.
                 'mkdir','mkdirat','mknod','mknodat','symlink','symlinkat','link','linkat',
                 'rename','renameat','renameat2','unlink','unlinkat','rmdir',
                 'truncate','ftruncate','chmod','fchmod','fchmodat','fchmodat2',
                 'chown','fchown','lchown','fchownat',
                 'utime','utimes','futimesat','utimensat',
                 'setxattr','lsetxattr','fsetxattr','removexattr','lremovexattr','fremovexattr',
                 'socketcall','io_uring_setup','pidfd_getfd','ptrace',
                 'ipc','shmget','shmat','shmdt','shmctl',
                 'msgget','msgsnd','msgrcv','msgctl',
                 'semget','semop','semtimedop','semctl',
                 'mq_open','mq_unlink','mq_timedsend','mq_timedreceive',
                 'mq_notify','mq_getsetattr',
                 'process_vm_readv','process_vm_writev',
                 # Same-UID children can lower a parent's scheduling/I/O priority
                 # without a capability, affecting later submissions too.
                 'sched_setscheduler','sched_setparam','sched_setattr',
                 'sched_setaffinity','setpriority','ioprio_set',
                 'kill','tkill','tgkill','pidfd_send_signal',
                 'rt_sigqueueinfo','rt_tgsigqueueinfo','setsid','setpgid')
        for name in blocked:
            number=lib.seccomp_syscall_resolve_name(name.encode())
            if number < 0:
                if name in ('socket','connect','kill'):
                    raise RuntimeError('required network syscall unavailable')
                continue  # syscall does not exist in the native ABI
            result=lib.seccomp_rule_add(context,0x00050000 | errno.EPERM,number,0)
            if result != 0:
                raise RuntimeError(f'could not deny syscall {name}: {result}')
        # setrlimit uses prlimit64(pid=0). Forbid changing any explicitly named
        # process, including the same-UID supervisor; read-only queries still work.
        class Compare(ctypes.Structure):
            _fields_=[('arg',ctypes.c_uint),('op',ctypes.c_int),
                      ('datum_a',ctypes.c_uint64),('datum_b',ctypes.c_uint64)]
        lib.seccomp_rule_add_array.argtypes=[ctypes.c_void_p,ctypes.c_uint32,
                                            ctypes.c_int,ctypes.c_uint,
                                            ctypes.POINTER(Compare)]
        lib.seccomp_rule_add_array.restype=ctypes.c_int
        number=lib.seccomp_syscall_resolve_name(b'prlimit64')
        if number < 0:
            raise RuntimeError('required resource-limit syscall unavailable')
        comparisons=(Compare*2)(Compare(0,1,0,0),Compare(2,1,0,0))  # SCMP_CMP_NE
        result=lib.seccomp_rule_add_array(context,0x00050000 | errno.EPERM,
                                          number,2,comparisons)
        if result != 0:
            raise RuntimeError(f'could not protect supervisor resource limits: {result}')
        result=lib.seccomp_load(context)
        if result != 0:
            raise RuntimeError(f'could not install network filter: {result}')
    finally:
        lib.seccomp_release(context)
