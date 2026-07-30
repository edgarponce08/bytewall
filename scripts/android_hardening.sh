#!/usr/bin/env bash
set -euo pipefail

echo "Android hardening helper"
# Generate keystore if missing (change passwords and info in CI)
if [ ! -f keystore.jks ]; then
  echo "Generating keystore.jks (use secure passwords in CI)"
  keytool -genkeypair -v -keystore keystore.jks -alias app -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass changeit -keypass changeit -dname "CN=Bytewall, OU=Dev, O=Org, L=City, ST=State, C=US"
fi

# Assemble release (skip tests to speed CI)
./gradlew assembleRelease -x test

# Suggest running lint and unit tests
./gradlew lint check

echo "Reminder: enable R8/ProGuard rules in android/app/proguard-rules.pro and review mapping.txt on releases"
