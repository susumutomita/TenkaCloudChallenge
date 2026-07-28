# Cloud Rescue

> 日本語版: [README.ja.md](./README.ja.md)

The customer frontend is down while the API on the same EC2 instance remains healthy. Investigate and restore the existing environment instead of replacing it.

## Learning goals

- Narrow the incident scope from the difference between frontend and API symptoms
- Connect through SSM Session Manager without SSH
- Inspect systemd state and journal evidence
- Verify the external state after recovery

## Flow

1. Compare `FrontendUrl` with `ApiUrl/healthz`.
2. Connect using `SsmStartSessionCommand`.
3. Inspect service state and logs.
4. Restore the stopped frontend.
5. Run `curl http://localhost:8080/recovery`, then submit the returned flag.

The recovery endpoint is available only from localhost and returns HTTP 503 until nginx returns HTTP 200. The flag is a completion marker, not a secrecy boundary against a learner with sudo access. Continuous state is assessed in `cloud-rescue-battle`.
