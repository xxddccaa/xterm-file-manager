#!/usr/bin/env python3
"""
SOCKS5 Proxy Script for SSH Connections

This script allows SSH to connect through a local SOCKS5 proxy.
Typically used in environments where direct access to GitHub is blocked.

Usage in ~/.ssh/config:
    Host github.com
        ProxyCommand python3 /path/to/this/script.py %h %p
        User git

Default proxy: 127.0.0.1:10828
Modify PROXY_PORT below if your proxy uses a different port.
"""

import socket
import sys
import struct
import select
import os

# Configure your local SOCKS5 proxy settings here
PROXY_HOST = "127.0.0.1"
PROXY_PORT = 10828  # Common ports: 10828, 1080, 7890


def socks5_connect(target_host, target_port):
    """Connect to target through SOCKS5 proxy"""
    # Connect to SOCKS5 proxy
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((PROXY_HOST, PROXY_PORT))

    # SOCKS5 greeting (no authentication)
    sock.sendall(b"\x05\x01\x00")

    # Get greeting response
    response = sock.recv(2)
    if response[1:2] != b"\x00":
        raise Exception("SOCKS5 proxy authentication failed")

    # Send connection request
    # Format: VER CMD RSV ATYP DST.ADDR DST.PORT
    # ATYP=0x03 means domain name
    request = (
        b"\x05\x01\x00\x03"  # VER=5, CMD=1(CONNECT), RSV=0, ATYP=3(DOMAIN)
        + bytes([len(target_host)])  # Domain length
        + target_host.encode()  # Domain name
        + struct.pack(">H", target_port)  # Port (big-endian unsigned short)
    )
    sock.sendall(request)

    # Get connection response (10 bytes)
    response = sock.recv(10)
    if response[1:2] != b"\x00":
        raise Exception(f"SOCKS5 connection failed: status={response[1]}")

    return sock


def forward_data(sock):
    """Forward data between stdin/stdout and socket"""
    try:
        while True:
            # Wait for data from socket or stdin
            readable, _, _ = select.select([sock, sys.stdin], [], [])

            # Data from remote host
            if sock in readable:
                data = sock.recv(8192)
                if not data:
                    break
                os.write(sys.stdout.fileno(), data)

            # Data from local SSH client
            if sys.stdin in readable:
                data = os.read(sys.stdin.fileno(), 8192)
                if not data:
                    break
                sock.sendall(data)
    except Exception as e:
        print(f"Error forwarding data: {e}", file=sys.stderr)
        raise


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <host> <port>", file=sys.stderr)
        sys.exit(1)

    target_host = sys.argv[1]
    target_port = int(sys.argv[2])

    try:
        sock = socks5_connect(target_host, target_port)
        forward_data(sock)
    except Exception as e:
        print(f"Proxy error: {e}", file=sys.stderr)
        sys.exit(1)
