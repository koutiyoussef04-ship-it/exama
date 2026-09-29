# Apple root certificates

App Store purchase data (StoreKit 2 JWS) is trusted only if its certificate chain leads to one of
the certificates in this folder. These are **public** certificates, not secrets.

| File | Certificate | SHA-256 fingerprint |
|---|---|---|
| `AppleRootCA-G3.cer` | Apple Root CA - G3 (valid until 2039-04-30) | `63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79` |

Before launch, download the certificate yourself from <https://www.apple.com/certificateauthority/>
("Apple Root CA - G3 Root") and check that the fingerprint matches, e.g.
`openssl x509 -inform DER -in AppleRootCA-G3.cer -noout -fingerprint -sha256`.
If Apple adds or rotates a root, put the new `.cer` file here (or point `APPLE_ROOT_CERTS_DIR` at a
folder that has it) — every `.cer`/`.der`/`.pem` file in the folder is trusted.
