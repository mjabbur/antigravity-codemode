#!/usr/bin/env bash
set -euo pipefail

RIPWIRE_VERSION="0.6.5"

# Determine repository root from script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Verify operating system
OS="$(uname -s)"
if [ "${OS}" != "Linux" ]; then
    echo "Error: install-ripwire.sh only supports Linux. Detected OS: ${OS}" >&2
    exit 1
fi

# Detect architecture
ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64)
        PLATFORM="linux-x64"
        ;;
    aarch64|arm64)
        PLATFORM="linux-arm64"
        ;;
    *)
        echo "Error: Unsupported Linux architecture '${ARCH}'. Supported: x86_64, aarch64/arm64." >&2
        exit 1
        ;;
esac

TARGET_DIR="${REPO_ROOT}/bin/ripwire-${RIPWIRE_VERSION}-${PLATFORM}"
BIN_PATH="${TARGET_DIR}/ripwire"

# Idempotency check: verify if binary already exists and matches target version
if [ -f "${BIN_PATH}" ]; then
    if [ -x "${BIN_PATH}" ]; then
        INSTALLED_VER="$("${BIN_PATH}" --version 2>/dev/null || true)"
        if echo "${INSTALLED_VER}" | grep -qF "ripwire ${RIPWIRE_VERSION} "; then
            echo "Ripwire v${RIPWIRE_VERSION} is already installed at: ${BIN_PATH}"
            "${BIN_PATH}" --version
            echo ""
            echo "Configuration for mcp_config.json:"
            echo "  \"RIPWIRE_PATH\": \"${BIN_PATH}\""
            exit 0
        fi
    fi
fi

# Check required utilities
for tool in curl tar sha256sum; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
        echo "Error: Missing required tool '${tool}'. Please install it and retry." >&2
        exit 1
    fi
done

BASE_URL="https://github.com/redhat-et/ripwire/releases/download/v${RIPWIRE_VERSION}"
ARCHIVE_NAME="ripwire-${RIPWIRE_VERSION}-${PLATFORM}.tar.gz"
SHA_NAME="${ARCHIVE_NAME}.sha256"

TMP_DIR="$(mktemp -d)"
cleanup() {
    rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "Downloading Ripwire v${RIPWIRE_VERSION} (${PLATFORM})..."
curl -fsSL "${BASE_URL}/${ARCHIVE_NAME}" -o "${TMP_DIR}/${ARCHIVE_NAME}"
curl -fsSL "${BASE_URL}/${SHA_NAME}" -o "${TMP_DIR}/${SHA_NAME}"

# Allow test override for checksum failure simulation
TEST_HASH_OVERRIDE="${RIPWIRE_INSTALL_TEST_HASH_OVERRIDE:-${TEST_RIPWIRE_EXPECTED_HASH:-}}"
if [ -n "${TEST_HASH_OVERRIDE}" ]; then
    echo "Applying test hash override: ${TEST_HASH_OVERRIDE}"
    echo "${TEST_HASH_OVERRIDE}  ${ARCHIVE_NAME}" > "${TMP_DIR}/${SHA_NAME}"
fi

echo "Verifying SHA256 checksum..."
if ! (cd "${TMP_DIR}" && sha256sum -c "${SHA_NAME}" >/dev/null 2>&1); then
    echo "Error: SHA256 checksum verification failed for ${ARCHIVE_NAME}!" >&2
    echo "Aborting installation without extracting." >&2
    exit 1
fi
echo "SHA256 checksum verified."

mkdir -p "${REPO_ROOT}/bin"
echo "Extracting ${ARCHIVE_NAME} to ${TARGET_DIR}..."
tar -xzf "${TMP_DIR}/${ARCHIVE_NAME}" -C "${REPO_ROOT}/bin"

chmod +x "${BIN_PATH}"

if [ ! -x "${BIN_PATH}" ]; then
    echo "Error: Binary not found or not executable at ${BIN_PATH} after extraction." >&2
    exit 1
fi

echo "Ripwire v${RIPWIRE_VERSION} installed successfully."
"${BIN_PATH}" --version
echo ""
echo "Configuration for mcp_config.json:"
echo "  \"RIPWIRE_PATH\": \"${BIN_PATH}\""
