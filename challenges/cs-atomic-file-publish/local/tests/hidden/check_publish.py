"""Hidden property checks for the three code checkpoints.

The pedagogical claim of this problem is about *moments the participant cannot see*:
what a reader observes while a publish is in flight, and what survives when the
process dies mid-write. Sampling those with a racing reader thread would make the
verdict depend on scheduler luck, so nothing here races.

Instead the suite installs an observer around the file APIs the submission uses. It
takes a snapshot of the destination at every write boundary — exactly the instants a
reader could have looked — and can raise at a chosen boundary to model a crash. Both
give the same verdict on every run and on every machine.
"""

from __future__ import annotations

import builtins
import hashlib
import importlib.util
import io
import os
import tempfile
from pathlib import Path
from types import ModuleType


class _CrashInjected(Exception):
    """Raised inside the observer to model the process dying mid-publish."""


def _seeded_text(seed: str, label: str, width: int = 16) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode("utf-8")).hexdigest()[:width]


def _document(seed: str, label: str, lines: int = 40) -> str:
    """A payload large enough that a non-atomic write is observably torn."""
    body = "\n".join(
        f"{index:04d} {_seeded_text(seed, f'{label}:{index}', 48)}" for index in range(lines)
    )
    return f"# {_seeded_text(seed, label + ':title', 24)}\n{body}\n"


class _Observer:
    """Watches a submission's writes to one destination directory.

    ``snapshots`` records the bytes of the destination file at every write boundary,
    starting with its state before the publish. ``crash_at`` makes the write at that
    boundary raise, which is how a mid-publish death is modelled without a subprocess.
    """

    def __init__(
        self,
        target: Path,
        crash_at: int | None = None,
        interleave: object = None,
    ) -> None:
        self.target = target
        self.crash_at = crash_at
        # Runs once, from inside the first write, to model a second publish that
        # overlaps this one. Re-entering is deterministic where two threads are not.
        self.interleave = interleave
        self._interleaved = False
        self.snapshots: list[bytes | None] = []
        self.writes = 0
        self.fsynced_paths: list[str] = []
        self.replaced: list[tuple[str, str]] = []
        self._fd_paths: dict[int, str] = {}
        self._real_open = builtins.open
        self._real_os_open = os.open
        # A submission that opens its work file with mkstemp writes through
        # os.fdopen, not builtins.open. Missing it would make every write invisible
        # and quietly turn the crash sweep into a no-op.
        self._real_fdopen = os.fdopen
        self._real_fsync = os.fsync
        self._real_replace = os.replace
        self._real_rename = os.rename

    # -- destination state -------------------------------------------------
    def _snapshot(self) -> None:
        try:
            self.snapshots.append(self.target.read_bytes())
        except FileNotFoundError:
            self.snapshots.append(None)
        except OSError:
            self.snapshots.append(None)

    def _note_write(self) -> None:
        self._snapshot()
        self.writes += 1
        if self.interleave is not None and not self._interleaved:
            self._interleaved = True
            self.interleave()
        if self.crash_at is not None and self.writes >= self.crash_at:
            raise _CrashInjected("process died mid-publish")

    # -- patched APIs ------------------------------------------------------
    def _wrap_stream(self, stream: object, path: str) -> object:
        observer = self
        if not isinstance(stream, (io.RawIOBase, io.BufferedIOBase, io.TextIOBase)):
            return stream

        class _Watched:
            def __getattr__(self, name: str) -> object:
                return getattr(stream, name)

            def write(self, data):  # noqa: ANN001, ANN202 - mirrors the wrapped stream
                observer._note_write()
                return stream.write(data)

            def writelines(self, lines):  # noqa: ANN001, ANN202
                for line in lines:
                    self.write(line)

            def fileno(self) -> int:
                handle = stream.fileno()
                observer._fd_paths[handle] = path
                return handle

            def __enter__(self):  # noqa: ANN202
                stream.__enter__()
                return self

            def __exit__(self, *exception: object) -> object:
                return stream.__exit__(*exception)

        return _Watched()

    def _open(self, file, mode="r", *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        stream = self._real_open(file, mode, *args, **kwargs)
        if any(flag in mode for flag in ("w", "a", "x", "+")):
            path = str(file)
            try:
                self._fd_paths[stream.fileno()] = path
            except (AttributeError, OSError, io.UnsupportedOperation):
                pass
            # Truncation is itself a destination change a reader can observe.
            if "w" in mode:
                self._snapshot()
            return self._wrap_stream(stream, path)
        return stream

    def _os_open(self, path, flags, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        handle = self._real_os_open(path, flags, *args, **kwargs)
        self._fd_paths[handle] = str(path)
        if flags & getattr(os, "O_TRUNC", 0):
            self._snapshot()
        return handle

    def _fdopen(self, fd, mode="r", *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        stream = self._real_fdopen(fd, mode, *args, **kwargs)
        path = self._fd_paths.get(fd, f"<fd:{fd}>")
        if any(flag in mode for flag in ("w", "a", "x", "+")):
            return self._wrap_stream(stream, path)
        return stream

    def _fsync(self, fd: int) -> None:
        self.fsynced_paths.append(self._fd_paths.get(fd, f"<fd:{fd}>"))
        self._real_fsync(fd)

    def _replace(self, src, dst, **kwargs):  # noqa: ANN001, ANN003, ANN202
        self.replaced.append((str(src), str(dst)))
        self._snapshot()
        result = self._real_replace(src, dst, **kwargs)
        self._snapshot()
        return result

    def _rename(self, src, dst, **kwargs):  # noqa: ANN001, ANN003, ANN202
        self.replaced.append((str(src), str(dst)))
        self._snapshot()
        result = self._real_rename(src, dst, **kwargs)
        self._snapshot()
        return result

    def __enter__(self) -> "_Observer":
        self._snapshot()
        builtins.open = self._open
        os.open = self._os_open
        os.fdopen = self._fdopen
        os.fsync = self._fsync
        os.replace = self._replace
        os.rename = self._rename
        return self

    def __exit__(self, *exception: object) -> bool:
        builtins.open = self._real_open
        os.open = self._real_os_open
        os.fdopen = self._real_fdopen
        os.fsync = self._real_fsync
        os.replace = self._real_replace
        os.rename = self._real_rename
        self._snapshot()
        return False


def _call(module: ModuleType, target: Path, content: object) -> object:
    try:
        return module.publish(target, content)
    except Exception as error:  # noqa: BLE001 - participant exceptions are a failed property
        return {"raised": type(error).__name__}


def _fresh(module: ModuleType) -> ModuleType:
    path = Path(str(getattr(module, "__file__", "")))
    if not path.is_file():
        return module
    spec = importlib.util.spec_from_file_location(f"participant_restart_{id(module)}", path)
    if spec is None or spec.loader is None:
        return module
    fresh = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fresh)
    return fresh


def _leftovers(directory: Path, target: Path) -> list[str]:
    return sorted(
        entry.name for entry in directory.iterdir() if entry.resolve() != target.resolve()
    )


def _publish_observed(
    module: ModuleType, target: Path, content: str, crash_at: int | None = None
) -> tuple[object, _Observer]:
    observer = _Observer(target, crash_at=crash_at)
    with observer:
        try:
            result = module.publish(target, content)
        except _CrashInjected:
            result = {"crashed": True}
        except Exception as error:  # noqa: BLE001 - a raising publish is still observed
            result = {"raised": type(error).__name__}
    return result, observer


def _torn_snapshots(observer: _Observer, allowed: tuple[bytes | None, ...]) -> list[str]:
    """Every observed destination state must be one of the allowed whole files."""
    for index, snapshot in enumerate(observer.snapshots):
        if snapshot not in allowed:
            shown = "missing" if snapshot is None else f"{len(snapshot)} bytes"
            return [f"a reader could observe the destination as {shown} during publish (#{index})"]
    return []


def _publish_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """The destination is never observed as anything but a whole file."""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        target = root / "config.json"
        old = _document(seed, f"{phase}:old")
        new = _document(seed, f"{phase}:new", lines=60)

        first, observer = _publish_observed(module, target, old)
        if not isinstance(first, dict) or first.get("ok") is not True:
            failures.append("publishing into an empty directory did not report success")
        if target.read_bytes() != old.encode("utf-8"):
            failures.append("the first publish did not leave the exact content on disk")
        failures.extend(_torn_snapshots(observer, (None, old.encode("utf-8"))))

        second, observer = _publish_observed(module, target, new)
        if not isinstance(second, dict) or second.get("ok") is not True:
            failures.append("replacing an existing file did not report success")
        if second.get("bytes") != len(new.encode("utf-8")):
            failures.append("the reported byte count did not match the published content")
        if target.read_bytes() != new.encode("utf-8"):
            failures.append("the replacing publish did not leave the exact content on disk")
        # This is the whole lesson: while the new file is being written the old one
        # must remain completely readable.
        failures.extend(
            _torn_snapshots(observer, (old.encode("utf-8"), new.encode("utf-8")))
        )
        if _leftovers(root, target):
            failures.append("a successful publish left a work file next to the destination")

        shorter = _document(seed, f"{phase}:short", lines=3)
        _, observer = _publish_observed(module, target, shorter)
        failures.extend(
            _torn_snapshots(observer, (new.encode("utf-8"), shorter.encode("utf-8")))
        )
        if target.read_bytes() != shorter.encode("utf-8"):
            failures.append("shrinking the published file left trailing bytes behind")

        rejected = _call(module, target, 12345)
        if rejected != {"ok": False, "error": "invalid_content"}:
            failures.append("invalid content did not return the documented error")
        if target.read_bytes() != shorter.encode("utf-8"):
            failures.append("a rejected publish changed the destination")
    return failures


def _durability_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """A publish interrupted at any point leaves a whole file and no debris."""
    failures = _publish_properties(module, seed, phase)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        target = root / "settings.conf"
        old = _document(seed, f"{phase}:old")
        new = _document(seed, f"{phase}:new", lines=80)
        module.publish(target, old)
        old_bytes = old.encode("utf-8")

        # Sweep the crash point across every write boundary the submission uses.
        boundaries = 0
        probe = _Observer(target)
        with probe:
            try:
                module.publish(target, new)
            except Exception:  # noqa: BLE001 - only the boundary count matters here
                pass
        boundaries = max(probe.writes, 1)
        module.publish(target, old)

        for crash_at in range(1, boundaries + 1):
            _, observer = _publish_observed(module, target, new, crash_at=crash_at)
            content = target.read_bytes() if target.exists() else None
            if content != old_bytes:
                failures.append(
                    f"a crash at write #{crash_at} left the destination neither old nor new"
                )
            failures.extend(_torn_snapshots(observer, (old_bytes, new.encode("utf-8"))))
            leftovers = _leftovers(root, target)
            if leftovers:
                failures.append(
                    f"a crash at write #{crash_at} left work files behind: {leftovers}"
                )
            # Recovery must not depend on the debris of the failed attempt.
            recovered = _call(_fresh(module), target, old)
            if not isinstance(recovered, dict) or recovered.get("ok") is not True:
                failures.append(f"publishing after a crash at write #{crash_at} did not recover")
            if target.read_bytes() != old_bytes:
                failures.append(f"recovery after a crash at write #{crash_at} lost content")

        # Durability: the data must reach the medium before the name points at it.
        _, observer = _publish_observed(module, target, new)
        if not observer.replaced:
            failures.append("the destination was not published by an atomic rename")
        if not observer.fsynced_paths:
            failures.append("the published bytes were never flushed to the medium")
        else:
            data_syncs = [
                index
                for index, path in enumerate(observer.fsynced_paths)
                if Path(path).name != root.name
            ]
            if not data_syncs:
                failures.append("the work file itself was never flushed before being renamed")
    return failures


def _generalize_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """The same publish holds for a fresh name, repeated runs and a durable directory."""
    failures = _durability_properties(module, seed, phase)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)

        # The rename creates a directory entry; without syncing the directory the new
        # name can be lost even though the data behind it was flushed.
        target = root / "fresh.txt"
        content = _document(seed, f"{phase}:fresh")
        _, observer = _publish_observed(module, target, content)
        directory_syncs = [
            path for path in observer.fsynced_paths if Path(path).resolve() == root.resolve()
        ]
        if not directory_syncs:
            failures.append("the directory entry created by the rename was never made durable")

        # A work file must be created beside the destination: a rename across
        # filesystems is not atomic, and /tmp is usually a different one.
        outside = [
            source
            for source, _ in observer.replaced
            if Path(source).parent.resolve() != root.resolve()
        ]
        if outside:
            failures.append("the work file was renamed in from another directory")

        # Repeated publishes of different sizes must never accumulate debris.
        for index in range(4):
            body = _document(seed, f"{phase}:repeat-{index}", lines=5 + index * 30)
            result = _call(module, target, body)
            if not isinstance(result, dict) or result.get("ok") is not True:
                failures.append(f"repeat publish #{index} did not report success")
            if target.read_bytes() != body.encode("utf-8"):
                failures.append(f"repeat publish #{index} did not leave the exact content")
            if _leftovers(root, target):
                failures.append(f"repeat publish #{index} left a work file behind")

        # Two destinations in one directory must not collide on a shared work name.
        other = root / "second.txt"
        first_body = _document(seed, f"{phase}:multi-a")
        second_body = _document(seed, f"{phase}:multi-b", lines=70)
        _call(module, target, first_body)
        _call(module, other, second_body)
        if target.read_bytes() != first_body.encode("utf-8"):
            failures.append("publishing a second file overwrote the first destination")
        if other.read_bytes() != second_body.encode("utf-8"):
            failures.append("publishing a second file did not leave its own content")

        # Overlapping publishes. A submission that reuses one fixed work-file name
        # survives every sequential check and still corrupts both files the moment two
        # publishes are in flight, so the second one is started from inside the first
        # one's write — deterministic where two threads would only be lucky.
        outer = root / "outer.txt"
        inner = root / "inner.txt"
        outer_body = _document(seed, f"{phase}:outer", lines=90)
        inner_body = _document(seed, f"{phase}:inner", lines=25)
        module.publish(outer, _document(seed, f"{phase}:outer-old", lines=10))
        nested: list[object] = []

        def _second_publish() -> None:
            nested.append(_call(_fresh(module), inner, inner_body))

        observer = _Observer(outer, interleave=_second_publish)
        with observer:
            try:
                module.publish(outer, outer_body)
            except Exception as error:  # noqa: BLE001 - a crash here is a failed property
                nested.append({"raised": type(error).__name__})
        if not nested or not isinstance(nested[0], dict) or nested[0].get("ok") is not True:
            failures.append("a publish started while another was in flight did not succeed")
        if not inner.exists() or inner.read_bytes() != inner_body.encode("utf-8"):
            failures.append("overlapping publishes did not leave the second file intact")
        if not outer.exists() or outer.read_bytes() != outer_body.encode("utf-8"):
            failures.append("overlapping publishes did not leave the first file intact")
        debris = [name for name in _leftovers(root, outer) if not name.endswith(".txt")]
        if debris:
            failures.append(f"overlapping publishes left work files behind: {debris}")

        missing = _call(module, root / "no-such-directory" / "file.txt", "hello")
        if missing != {"ok": False, "error": "invalid_target"}:
            failures.append("a target in a missing directory did not return the documented error")
    return failures


def check_publish(module: ModuleType, seed: str) -> list[str]:
    return _publish_properties(module, seed, "publish-checkpoint")


def check_durable(module: ModuleType, seed: str) -> list[str]:
    return _durability_properties(module, seed, "durable-checkpoint")


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "full-run")
