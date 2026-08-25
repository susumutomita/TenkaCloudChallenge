"""A deliberately incomplete ACM validation-method migration policy.

The public contract is ``migrate_step(client)``. It is called once per scheduler tick (the
Compose Workbench and the hidden verifier call it repeatedly, advancing a simulated clock between
calls) and must return::

    {"certificates": {"<arn>": {"done": bool, "aborted": bool}, ...}}

with one entry for every certificate ``client.list_certificates()`` currently reports.

This starter switches every certificate that is still on EMAIL validation over to DNS validation
and publishes a CNAME for each domain it finds. It passes the public tests, which only cover a
single certificate with a single domain in a single hosted zone. It has not been checked against a
certificate with multiple SANs split across hosted zones, against the 72-hour migration deadline,
or against what "done" should actually mean. For a certificate that also covers SANs, it reaches
for ``request_certificate`` instead of trusting ``update_certificate_options`` alone — which is
exactly the shortcut this migration must not take.
"""

from __future__ import annotations


def _already_has_a_replacement(cert: dict, all_certs: list[dict]) -> bool:
    return any(
        other["arn"] != cert["arn"] and other["domainName"] == cert["domainName"]
        for other in all_certs
    )


def migrate_step(client) -> dict:
    results: dict[str, dict] = {}
    all_certs = client.list_certificates()

    for cert in all_certs:
        arn = cert["arn"]
        needs_migration = cert["validationMethod"] != "DNS"

        # TODO: a certificate with extra SANs looks harder to switch safely in one place, so this
        # requests a brand-new certificate covering the same domains as a "clean slate" instead of
        # trusting update_certificate_options to carry every SAN across. Like the real API, the
        # call itself succeeds — it just mints a new ARN. Every ALB listener, CloudFront
        # distribution, or API Gateway domain that still points at the old ARN now points at a
        # certificate that will never finish migrating, and the old ARN is never cleaned up.
        if needs_migration and cert["sans"] and not _already_has_a_replacement(cert, all_certs):
            client.request_certificate(cert["domainName"], cert["sans"], "DNS")

        if needs_migration:
            client.update_certificate_options(arn, "DNS")

        # TODO: this policy is broader than any single migration needs.
        client.declare_dns_write_policy(
            [
                {
                    "Effect": "Allow",
                    "Action": ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets"],
                    "Resource": ["arn:aws:route53:::hostedzone/*"],
                }
            ]
        )

        # TODO: every domain is written into the *primary* domain's hosted zone. A SAN delegated
        # to a different DNS owner never gets its record where that owner can see it.
        zone_id = client.hosted_zone_for_domain(cert["domainName"])
        for validation in client.list_certificate_domain_validations(arn):
            record = validation.get("resourceRecord")
            if record is None:
                continue
            client.change_resource_record_sets(
                zone_id, "UPSERT", record["name"], "CNAME", record["value"]
            )

        # TODO: the API call above only *asks* for validation. It says nothing about whether any
        # domain has actually validated yet, or whether the certificate is renewal-eligible.
        results[arn] = {"done": True, "aborted": False}

    return {"certificates": results}
