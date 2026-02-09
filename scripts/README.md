# Scripts Directory

This directory contains utility scripts for the XTerm File Manager project.

## SSH SOCKS5 Proxy Script

### Purpose
`ssh_socks5_proxy.py` allows SSH connections (like `git push`) to work through a local SOCKS5 proxy. This is essential in environments where direct access to GitHub is blocked.

### Configuration

1. **Edit proxy settings** (if your proxy is not on port 10828):
   ```bash
   # Open the script
   nano scripts/ssh_socks5_proxy.py
   
   # Modify these lines:
   PROXY_HOST = "127.0.0.1"
   PROXY_PORT = 10828  # Change to your proxy port (1080, 7890, etc.)
   ```

2. **Update SSH config** to use this script:
   ```bash
   # Edit ~/.ssh/config
   nano ~/.ssh/config
   
   # Add or update GitHub configuration:
   Host github.com
       ProxyCommand python3 /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/scripts/ssh_socks5_proxy.py %h %p
       User git
       StrictHostKeyChecking no
       UserKnownHostsFile /dev/null
   ```
   
   **Important:** Replace the path with your actual project path. You can get it with:
   ```bash
   pwd  # Run this in the project root directory
   ```

3. **Test the connection**:
   ```bash
   ssh -T git@github.com
   # Should see: Hi xxddccaa! You've successfully authenticated...
   ```

### Common Proxy Ports
- `10828` - Common custom proxy
- `1080` - Default SOCKS5 port
- `7890` - Clash/ClashX default port
- `7891` - Alternative Clash port

### Troubleshooting

**Error: "Connection refused"**
- Your proxy is not running
- Wrong proxy port configured

**Error: "Authentication failed"**
- Your proxy requires authentication (script currently only supports no-auth SOCKS5)

**Error: "Connection timeout"**
- Firewall blocking the connection
- Proxy not accessible

**Still not working?**
```bash
# Test proxy directly with curl
curl -x socks5://127.0.0.1:10828 https://github.com
```

## Other Scripts

### `test-keyboard.sh`
Test keyboard input in terminal (for debugging terminal key events).

### `karabiner-config.json`
Karabiner-Elements configuration for custom keyboard mappings.
