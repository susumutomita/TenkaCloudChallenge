FROM mysql:8.0@sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b
# Oracle Linux 9: require the incident fix, not just a successful package command.
RUN microdnf upgrade -y ca-certificates \
    && rpm -q --whatprovides "ca-certificates >= 2025.2.80_v9.0.305-91.0.1.el9" \
    && microdnf clean all
