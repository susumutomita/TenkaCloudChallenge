FROM python:3.11.17-slim@sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377
# pip also vendors its own roots. Bootstrap the fixed release by its official hash.
RUN python -m pip install --no-cache-dir "pip @ https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl#sha256=fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70"
# Botocore otherwise uses its own bundled CA file, independently of certifi.
ENV AWS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
