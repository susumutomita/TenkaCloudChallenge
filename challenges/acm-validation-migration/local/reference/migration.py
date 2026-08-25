"""Reference implementation: migrate every certificate to DNS validation without a new ARN.

``migrate_step(client)`` is one idempotent scheduler tick. It never mints a new certificate, never
touches a certificate that does not need migrating, and never claims a certificate is done until an
independent re-query of every one of its domains says so. Past the 72-hour deadline it stops
issuing writes and reports the certificate as aborted instead of retrying forever or pretending
partial validation is success.
"""

from __future__ import annotations


def migrate_step(client) -> dict:
    certificates = client.list_certificates()

    # Declare one combined policy up front, covering every hosted zone this tick's migrating
    # certificates need — not one declaration per certificate. `declare_dns_write_policy`
    # replaces the previous declaration rather than merging into it, so declaring it inside the
    # per-certificate loop below would silently narrow access down to whichever certificate was
    # processed last.
    needed_zone_ids = sorted(
        {
            zone_id
            for cert in certificates
            if cert["validationMethod"] != "DNS"
            for domain in [cert["domainName"], *cert["sans"]]
            for zone_id in [client.hosted_zone_for_domain(domain)]
            if zone_id is not None
        }
    )
    if needed_zone_ids:
        client.declare_dns_write_policy(
            [
                {
                    "Effect": "Allow",
                    "Action": [
                        "route53:ChangeResourceRecordSets",
                        "route53:ListResourceRecordSets",
                    ],
                    "Resource": [
                        f"arn:aws:route53:::hostedzone/{zone_id}" for zone_id in needed_zone_ids
                    ],
                }
            ]
        )

    results: dict[str, dict] = {}
    for cert in certificates:
        arn = cert["arn"]

        if cert["validationMethod"] != "DNS":
            client.update_certificate_options(arn, "DNS")

        current = client.describe_certificate(arn)
        deadline_at = (
            current["optionsUpdatedAt"] + client.deadline_seconds()
            if current["optionsUpdatedAt"] is not None
            else None
        )
        past_deadline = deadline_at is not None and client.now() >= deadline_at

        if not past_deadline:
            for validation in client.list_certificate_domain_validations(arn):
                record = validation.get("resourceRecord")
                if record is None:
                    continue
                zone_id = client.hosted_zone_for_domain(validation["domainName"])
                if zone_id is None:
                    continue
                client.change_resource_record_sets(
                    zone_id, "UPSERT", record["name"], "CNAME", record["value"]
                )

        validations = client.list_certificate_domain_validations(arn)
        all_validated = bool(validations) and all(
            v["validationStatus"] == "SUCCESS" for v in validations
        )
        renewal_eligible = client.describe_certificate(arn)["renewalEligibility"] == "ELIGIBLE"

        if all_validated and renewal_eligible:
            results[arn] = {"done": True, "aborted": False}
        elif past_deadline:
            results[arn] = {
                "done": False,
                "aborted": True,
                "reason": "72-hour validation deadline exceeded with a pending domain",
            }
        else:
            results[arn] = {"done": False, "aborted": False}

    return {"certificates": results}
