"""
Institutional LAN TLS/HTTPS Certificate Generator for Ethio-Italy Polytechnic College (EIPC).
Generates production-grade self-signed X.509 certificates with Subject Alternative Names (SAN)
covering LAN IP addresses, localhost, and college domain names.

Satisfies Section 5 (Deployment & Security) and ensures browser secure context (window.isSecureContext)
for biometric hardware camera access without experimental browser flags.
"""
import os
import sys
import socket
import argparse
import datetime
import ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization


def get_local_ip_addresses() -> list[str]:
    """Discover active LAN IPv4 addresses on this machine."""
    ips = ["127.0.0.1"]
    try:
        # Connect to an external address (doesn't send data) to discover primary routing IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        primary_ip = s.getsockname()[0]
        s.close()
        if primary_ip not in ips:
            ips.append(primary_ip)
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass

    return ips


def generate_lan_certificate(
    output_dir: str,
    common_name: str = "eipc.lan",
    additional_ips: list[str] | None = None,
    additional_hosts: list[str] | None = None,
    validity_days: int = 825,  # 825 days is max accepted by iOS/macOS/Chrome for self-signed leaf certs
) -> tuple[str, str]:
    """
    Generate an RSA private key and self-signed X.509 certificate with Subject Alternative Names (SAN).
    Saves 'eipc.crt' and 'eipc.key' in output_dir.
    """
    os.makedirs(output_dir, exist_ok=True)
    cert_path = os.path.join(output_dir, "eipc.crt")
    key_path = os.path.join(output_dir, "eipc.key")

    print(f"[*] Generating 2048-bit RSA Private Key...")
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # Compile all SAN IP addresses
    san_ips = get_local_ip_addresses()
    if additional_ips:
        for ip in additional_ips:
            if ip not in san_ips:
                san_ips.append(ip)

    # Compile all SAN Hostnames
    san_hosts = [
        "localhost",
        common_name,
        "eipc.lan",
        "eipc-attendance.lan",
        "eipc-gate.lan",
        "attendance.eipc.edu.et",
        socket.gethostname(),
    ]
    if additional_hosts:
        for h in additional_hosts:
            if h not in san_hosts:
                san_hosts.append(h)

    print(f"[*] Target Subject Alternative Names (SAN):")
    for ip in san_ips:
        print(f"    - IP:  {ip}")
    for h in san_hosts:
        print(f"    - DNS: {h}")

    # Build SAN extension entries
    san_entries: list[x509.GeneralName] = []
    for h in san_hosts:
        san_entries.append(x509.DNSName(h))
    for ip_str in san_ips:
        try:
            san_entries.append(x509.IPAddress(ipaddress.ip_address(ip_str)))
        except ValueError:
            pass

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "ET"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Dire Dawa"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "Dire Dawa"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Ethio-Italy Polytechnic College"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "ICT & Biometrics Security Division"),
        x509.NameAttribute(NameOID.COMMON_NAME, common_name),
    ])

    now = datetime.datetime.now(datetime.timezone.utc)
    cert_builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=validity_days))
        .add_extension(
            x509.SubjectAlternativeName(san_entries),
            critical=False,
        )
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([
                ExtendedKeyUsageOID.SERVER_AUTH,
                ExtendedKeyUsageOID.CLIENT_AUTH,
            ]),
            critical=False,
        )
    )

    cert = cert_builder.sign(private_key, hashes.SHA256())

    # Write Private Key (PEM, unencrypted for Nginx / Gunicorn / Flask daemon)
    with open(key_path, "wb") as f:
        f.write(
            private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )

    # Write Certificate (PEM)
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"\n[+] TLS Certificate generated successfully!")
    print(f"    - Certificate: {cert_path}")
    print(f"    - Private Key: {key_path}")
    print(f"    - Validity:    {validity_days} days (Expires {cert.not_valid_after_utc.strftime('%Y-%m-%d')})")

    return cert_path, key_path


def main():
    parser = argparse.ArgumentParser(description="Generate Institutional LAN TLS/HTTPS Certificates for EIPC")
    parser.add_argument(
        "--output-dir",
        default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "nginx", "ssl"),
        help="Directory to save eipc.crt and eipc.key (default: backend/nginx/ssl)",
    )
    parser.add_argument("--cn", default="eipc.lan", help="Common Name (default: eipc.lan)")
    parser.add_argument("--ip", action="append", help="Additional IP address to include in SAN")
    parser.add_argument("--host", action="append", help="Additional Hostname to include in SAN")
    parser.add_argument("--days", type=int, default=825, help="Validity period in days (default: 825)")
    args = parser.parse_args()

    generate_lan_certificate(
        output_dir=args.output_dir,
        common_name=args.cn,
        additional_ips=args.ip,
        additional_hosts=args.host,
        validity_days=args.days,
    )


if __name__ == "__main__":
    main()

