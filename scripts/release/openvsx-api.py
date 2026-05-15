#!/usr/bin/env python3
"""Small Open VSX API helper that avoids the ovsx credential store.

Use this on SSH/headless hosts where the Node-based ovsx CLI can fail with
FreeDesktop secret-service errors or TLS ECONNRESET while Python HTTPS works.
The helper reads a token from OVSX_PAT first, then from the ovsx file store
(~/.ovsx), and finally from a hidden prompt.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

DEFAULT_REGISTRY = "https://open-vsx.org"
DEFAULT_NAMESPACE = "devsessioncanvas"
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_STORE_PATH = Path.home() / ".ovsx"


class OpenVsxError(RuntimeError):
    pass


def prefer_ipv4() -> None:
    original_getaddrinfo = socket.getaddrinfo

    def getaddrinfo_ipv4_first(*args: Any, **kwargs: Any) -> list[Any]:
        results = original_getaddrinfo(*args, **kwargs)
        return sorted(results, key=lambda item: 0 if item[0] == socket.AF_INET else 1)

    socket.getaddrinfo = getaddrinfo_ipv4_first  # type: ignore[assignment]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Call selected Open VSX registry APIs.")
    parser.add_argument(
        "--registry-url",
        default=DEFAULT_REGISTRY,
        help=f"Open VSX registry base URL. Defaults to {DEFAULT_REGISTRY}.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"HTTP timeout in seconds. Defaults to {DEFAULT_TIMEOUT_SECONDS}.",
    )
    parser.add_argument(
        "--token-env",
        default="OVSX_PAT",
        help="Environment variable containing the Open VSX token. Defaults to OVSX_PAT.",
    )
    parser.add_argument(
        "--store-path",
        default=str(DEFAULT_STORE_PATH),
        help=f"ovsx file-store path. Defaults to {DEFAULT_STORE_PATH}.",
    )
    parser.add_argument(
        "--prefer-ipv4",
        action="store_true",
        help="Resolve IPv4 addresses before IPv6 for this process.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    create_parser = subparsers.add_parser("create-namespace", help="Create a namespace.")
    create_parser.add_argument("namespace", nargs="?", default=DEFAULT_NAMESPACE)

    verify_parser = subparsers.add_parser("verify-pat", help="Verify the token for a namespace.")
    verify_parser.add_argument("namespace", nargs="?", default=DEFAULT_NAMESPACE)

    publish_parser = subparsers.add_parser("publish", help="Publish a VSIX package.")
    publish_parser.add_argument("vsix", help="Path to the .vsix file to publish.")
    publish_parser.add_argument(
        "--namespace",
        help="Namespace used to look up the token. Defaults to the VSIX publisher, then devsessioncanvas.",
    )

    return parser.parse_args()


def registry_url(base_url: str, path: str, query: dict[str, str] | None = None) -> str:
    base = base_url.rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    return url


def read_file_store_token(namespace: str, store_path: Path) -> str | None:
    if not store_path.exists():
        return None
    try:
        data = json.loads(store_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise OpenVsxError(f"Invalid ovsx file store JSON at {store_path}: {err}") from err

    entries = data.get("entries", [])
    if not isinstance(entries, list):
        raise OpenVsxError(f"Invalid ovsx file store format at {store_path}: entries must be a list")

    for entry in entries:
        if isinstance(entry, dict) and entry.get("name") == namespace:
            value = str(entry.get("value", "")).strip()
            if value:
                return value
    return None


def get_token(namespace: str, token_env: str, store_path: Path) -> str:
    token = os.environ.get(token_env, "").strip()
    if token:
        return token

    token = read_file_store_token(namespace, store_path)
    if token:
        return token

    token = getpass.getpass(f"Open VSX token for namespace '{namespace}': ").strip()
    if not token:
        raise OpenVsxError("No Open VSX token provided.")
    return token


def parse_vsix_publisher(vsix_path: Path) -> str | None:
    try:
        with zipfile.ZipFile(vsix_path) as package:
            with package.open("extension/package.json") as manifest_file:
                manifest = json.loads(manifest_file.read().decode("utf-8"))
    except (KeyError, FileNotFoundError, json.JSONDecodeError, zipfile.BadZipFile):
        return None
    publisher = manifest.get("publisher")
    return publisher if isinstance(publisher, str) and publisher.strip() else None


def parse_error_body(body: str) -> str:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return body.strip() or "<empty response>"
    if isinstance(parsed, dict):
        message = parsed.get("message") or parsed.get("error")
        if message:
            return str(message)
    return json.dumps(parsed, ensure_ascii=False)


def request_json(url: str, timeout: float, method: str = "GET", body: bytes | None = None) -> tuple[int, str]:
    headers = {"User-Agent": "dev-session-canvas-openvsx-helper"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8", "replace")


def request_octet_stream(url: str, timeout: float, file_path: Path) -> tuple[int, str]:
    data = file_path.read_bytes()
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/octet-stream",
            "User-Agent": "dev-session-canvas-openvsx-helper",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8", "replace")


def create_namespace(args: argparse.Namespace) -> int:
    namespace = args.namespace
    token = get_token(namespace, args.token_env, Path(args.store_path))
    url = registry_url(args.registry_url, "api/-/namespace/create", {"token": token})
    body = json.dumps({"name": namespace}).encode("utf-8")
    status, response = request_json(url, args.timeout, method="POST", body=body)
    print(f"Created namespace {namespace} (HTTP {status}).")
    if response.strip():
        print(response)
    return 0


def verify_pat(args: argparse.Namespace) -> int:
    namespace = args.namespace
    token = get_token(namespace, args.token_env, Path(args.store_path))
    url = registry_url(args.registry_url, f"api/{urllib.parse.quote(namespace)}/verify-pat", {"token": token})
    status, response = request_json(url, args.timeout)
    print(f"Verified token for namespace {namespace} (HTTP {status}).")
    if response.strip():
        print(response)
    return 0


def publish(args: argparse.Namespace) -> int:
    vsix_path = Path(args.vsix)
    if not vsix_path.is_file():
        raise OpenVsxError(f"VSIX not found: {vsix_path}")

    namespace = args.namespace or parse_vsix_publisher(vsix_path) or DEFAULT_NAMESPACE
    token = get_token(namespace, args.token_env, Path(args.store_path))
    url = registry_url(args.registry_url, "api/-/publish", {"token": token})
    status, response = request_octet_stream(url, args.timeout, vsix_path)
    print(f"Published {vsix_path} using namespace {namespace} (HTTP {status}).")
    if response.strip():
        print(response)
    return 0


def main() -> int:
    args = parse_args()
    if args.prefer_ipv4:
        prefer_ipv4()

    try:
        if args.command == "create-namespace":
            return create_namespace(args)
        if args.command == "verify-pat":
            return verify_pat(args)
        if args.command == "publish":
            return publish(args)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        print(f"HTTP {err.code}: {parse_error_body(body)}", file=sys.stderr)
        return 1
    except urllib.error.URLError as err:
        print(f"Network error: {err.reason}", file=sys.stderr)
        return 2
    except (ConnectionResetError, TimeoutError, OpenVsxError) as err:
        print(f"Error: {err}", file=sys.stderr)
        return 2

    print(f"Unknown command: {args.command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
