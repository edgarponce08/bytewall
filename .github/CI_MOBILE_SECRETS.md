CI Mobile secrets (repo secrets needed for mobile signing)

Android secrets (add via gh or GitHub UI):
- ANDROID_KEYSTORE_BASE64  -> Base64-encoded keystore file (keystore.jks)
- ANDROID_KEYSTORE_PASSWORD
- ANDROID_KEY_ALIAS
- ANDROID_KEY_PASSWORD

iOS secrets:
- IOS_CERTIFICATE_BASE64 -> Base64-encoded .p12 certificate (distribution)
- IOS_CERTIFICATE_PASSWORD
- IOS_PROVISIONING_PROFILE_BASE64 -> Base64-encoded provisioning profile (.mobileprovision)

Suggested gh CLI commands (local machine):
- gh secret set ANDROID_KEYSTORE_BASE64 --body "$(base64 -w0 keystore.jks)" --repo OWNER/REPO
- gh secret set ANDROID_KEYSTORE_PASSWORD --body "<password>" --repo OWNER/REPO
- gh secret set ANDROID_KEY_ALIAS --body "<alias>" --repo OWNER/REPO
- gh secret set ANDROID_KEY_PASSWORD --body "<keypass>" --repo OWNER/REPO

- gh secret set IOS_CERTIFICATE_BASE64 --body "$(base64 -w0 cert.p12)" --repo OWNER/REPO
- gh secret set IOS_CERTIFICATE_PASSWORD --body "<certpass>" --repo OWNER/REPO
- gh secret set IOS_PROVISIONING_PROFILE_BASE64 --body "$(base64 -w0 profile.mobileprovision)" --repo OWNER/REPO

Notes:
- Use base64 -w0 on Linux/macOS. On macOS without -w, use: base64 cert.p12 | tr -d '\n'
- Prefer using GitHub Actions OIDC + cloud KMS for ephemeral credentials where possible.
- Protect the repo secrets and enable branch protection so only maintainers can merge release tags.
