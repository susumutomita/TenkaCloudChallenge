"""Intentionally incomplete public tests: the shipped starter passes all of them.

They only exercise the "public" scenario: one certificate with one domain in one hosted zone,
plus one certificate that is already fully DNS-validated. They never check a certificate with
multiple SANs, a delegated hosted zone, the 72-hour deadline, or what "done" should mean.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "migration.py"

sys.path.insert(0, str(ROOT))

from fixtures.aws_lab import AwsLab  # noqa: E402


def _load():
    spec = importlib.util.spec_from_file_location("participant_migration", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load migration.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "migrate_step"):
        raise AssertionError("migration.py must define migrate_step()")
    return module


def _solo_arn(client: AwsLab) -> str:
    for cert in client.list_certificates():
        if cert["validationMethod"] != "DNS":
            return cert["arn"]
    raise AssertionError("the public scenario always has one certificate needing migration")


def test_switches_method_to_dns() -> None:
    module = _load()
    client = AwsLab("public-seed", "public")
    arn = _solo_arn(client)
    module.migrate_step(client)
    assert client.describe_certificate(arn)["validationMethod"] == "DNS"


def test_publishes_a_record_for_the_domain() -> None:
    module = _load()
    client = AwsLab("public-seed", "public")
    arn = _solo_arn(client)
    module.migrate_step(client)
    domain = client.describe_certificate(arn)["domainName"]
    [validation] = [
        v for v in client.list_certificate_domain_validations(arn) if v["domainName"] == domain
    ]
    record = validation["resourceRecord"]
    assert record is not None
    zone_id = client.hosted_zone_for_domain(domain)
    published = client.list_resource_record_sets(zone_id)
    assert any(r["name"] == record["name"] and r["value"] == record["value"] for r in published)


def test_result_has_one_entry_per_certificate() -> None:
    module = _load()
    client = AwsLab("public-seed", "public")
    expected_arns = {cert["arn"] for cert in client.list_certificates()}
    result = module.migrate_step(client)
    assert isinstance(result, dict)
    certificates = result.get("certificates")
    assert isinstance(certificates, dict)
    assert set(certificates) == expected_arns
    for entry in certificates.values():
        assert isinstance(entry, dict)
        assert isinstance(entry.get("done"), bool)


def test_does_not_replace_the_certificate() -> None:
    module = _load()
    client = AwsLab("public-seed", "public")
    original_arns = sorted(cert["arn"] for cert in client.list_certificates())
    module.migrate_step(client)
    assert sorted(cert["arn"] for cert in client.list_certificates()) == original_arns


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    sys.path.insert(0, str(ROOT))
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "acm-validation-migration"
    assert [item["id"] for item in config["checkpoints"]] == [
        "inventory",
        "preserve-identity",
        "publish-records",
        "least-privilege",
        "deadline-retry",
        "verify-renewal",
    ]
    files = server.starter_payload()
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {
        "preserve-identity",
        "publish-records",
        "least-privilege",
        "deadline-retry",
        "verify-renewal",
    }


TESTS = {
    name: value
    for name, value in globals().items()
    if name.startswith("test_") and callable(value)
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    selected = {name: test for name, test in TESTS.items() if args.only in name}
    if not selected:
        print("no public test matched", file=sys.stderr)
        return 2
    failures: list[str] = []
    for name, test in selected.items():
        try:
            test()
            print(f"pass {name}")
        except Exception as error:  # noqa: BLE001 - test runner reports each failure
            failures.append(name)
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    if failures:
        print(f"{len(failures)} failed")
        return 1
    print(f"all passed ({len(selected)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
