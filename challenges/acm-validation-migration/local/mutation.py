"""Break the reference nine ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_migration import run

REFERENCE = (Path(__file__).parent / "reference" / "migration.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "requests a replacement certificate instead of switching validation method",
        '        if cert["validationMethod"] != "DNS":\n            client.update_certificate_options(arn, "DNS")',
        '        if cert["validationMethod"] != "DNS":\n            client.request_certificate(cert["domainName"], tuple(cert["sans"]))',
    ),
    (
        "ignores SAN domains and only migrates the primary domain",
        '            for validation in client.list_certificate_domain_validations(arn):\n                record = validation.get("resourceRecord")',
        '            for validation in client.list_certificate_domain_validations(arn):\n                if validation["domainName"] != cert["domainName"]:\n                    continue\n                record = validation.get("resourceRecord")',
    ),
    (
        "publishes every domain's record into the primary domain's hosted zone",
        '                zone_id = client.hosted_zone_for_domain(validation["domainName"])\n                if zone_id is None:\n                    continue',
        '                zone_id = client.hosted_zone_for_domain(cert["domainName"])\n                if zone_id is None:\n                    continue',
    ),
    (
        "publishes the record name as its own value instead of the expected CNAME value",
        'client.change_resource_record_sets(\n                    zone_id, "UPSERT", record["name"], "CNAME", record["value"]\n                )',
        'client.change_resource_record_sets(\n                    zone_id, "UPSERT", record["name"], "CNAME", record["name"]\n                )',
    ),
    (
        "declares a wildcard hosted-zone policy instead of the zones actually needed",
        '                    "Resource": [\n                        f"arn:aws:route53:::hostedzone/{zone_id}" for zone_id in needed_zone_ids\n                    ],',
        '                    "Resource": ["arn:aws:route53:::hostedzone/*"],',
    ),
    (
        "declares every certificate done without checking validation status",
        '        if all_validated and renewal_eligible:\n            results[arn] = {"done": True, "aborted": False}',
        '        if True:\n            results[arn] = {"done": True, "aborted": False}',
    ),
    (
        "never recognizes the 72-hour deadline and keeps retrying past it",
        "        past_deadline = deadline_at is not None and client.now() >= deadline_at",
        "        past_deadline = False",
    ),
    (
        "uses CREATE instead of UPSERT so an idempotent retry errors",
        'client.change_resource_record_sets(\n                    zone_id, "UPSERT", record["name"], "CNAME", record["value"]\n                )',
        'client.change_resource_record_sets(\n                    zone_id, "CREATE", record["name"], "CNAME", record["value"]\n                )',
    ),
    (
        "treats one validated domain as the whole certificate being validated",
        '        all_validated = bool(validations) and all(\n            v["validationStatus"] == "SUCCESS" for v in validations\n        )\n        renewal_eligible = client.describe_certificate(arn)["renewalEligibility"] == "ELIGIBLE"',
        '        all_validated = bool(validations) and any(\n            v["validationStatus"] == "SUCCESS" for v in validations\n        )\n        renewal_eligible = True',
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-only test
    return module


def main() -> int:
    baseline = run(_load(REFERENCE), SEED)
    if baseline:
        print("the reference does not pass its hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    survivors: list[str] = []
    for name, before, after in MUTATIONS:
        if before not in REFERENCE:
            print(f"BROKEN {name}: mutation target is missing")
            survivors.append(name)
            continue
        source = REFERENCE.replace(before, after, 1)
        try:
            failures = run(_load(source), SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
