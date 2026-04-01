package app

import (
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

const (
	SSHKeyPassphraseRequiredPrefix = "SSH_KEY_PASSPHRASE_REQUIRED:"
	SSHKeyPassphraseInvalidPrefix  = "SSH_KEY_PASSPHRASE_INVALID:"
)

type sshPromptInputs struct {
	Password        string
	PasswordHost    string
	KeyPassphrase   string
	KeyIdentityFile string
}

type sshAgentHandle struct {
	Client agent.ExtendedAgent
	Conn   net.Conn
}

func (h *sshAgentHandle) Close() error {
	if h == nil || h.Conn == nil {
		return nil
	}
	return h.Conn.Close()
}

type sshAuthBuildResult struct {
	Methods             []ssh.AuthMethod
	DeferredPrompt      error
	UsingCachedPassword bool
	UsedPromptPassword  bool
}

type proxyCommandConn struct {
	stdout    io.ReadCloser
	stdin     io.WriteCloser
	stderr    io.ReadCloser
	cmd       *exec.Cmd
	closeOnce bool
}

func (c *proxyCommandConn) Read(p []byte) (int, error)         { return c.stdout.Read(p) }
func (c *proxyCommandConn) Write(p []byte) (int, error)        { return c.stdin.Write(p) }
func (c *proxyCommandConn) LocalAddr() net.Addr                { return dummyAddr("proxy-command-local") }
func (c *proxyCommandConn) RemoteAddr() net.Addr               { return dummyAddr("proxy-command-remote") }
func (c *proxyCommandConn) SetDeadline(_ time.Time) error      { return nil }
func (c *proxyCommandConn) SetReadDeadline(_ time.Time) error  { return nil }
func (c *proxyCommandConn) SetWriteDeadline(_ time.Time) error { return nil }
func (d dummyAddr) Network() string                            { return "ssh" }
func (d dummyAddr) String() string                             { return string(d) }

type dummyAddr string

func (c *proxyCommandConn) Close() error {
	if c.closeOnce {
		return nil
	}
	c.closeOnce = true

	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	if c.stdout != nil {
		_ = c.stdout.Close()
	}
	if c.stderr != nil {
		_ = c.stderr.Close()
	}
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
		_, _ = c.cmd.Process.Wait()
	}
	return nil
}

func newSSHPasswordRequiredError(reasonCode, host, message string) error {
	return fmt.Errorf("%s%s|%s|%s", SSHPasswordRequiredPrefix, reasonCode, host, message)
}

func newSSHPasswordInvalidError(host, message string) error {
	return fmt.Errorf("%s%s|%s", SSHPasswordInvalidPrefix, host, message)
}

func newSSHKeyPassphraseRequiredError(reasonCode, identityFile, host, message string) error {
	return fmt.Errorf("%s%s|%s|%s|%s", SSHKeyPassphraseRequiredPrefix, reasonCode, identityFile, host, message)
}

func newSSHKeyPassphraseInvalidError(identityFile, host, message string) error {
	return fmt.Errorf("%s%s|%s|%s", SSHKeyPassphraseInvalidPrefix, identityFile, host, message)
}

func sshConfigEntryFromResolved(resolved *ResolvedSSHConfig) SSHConfigEntry {
	entry := SSHConfigEntry{
		Host:     resolved.Alias,
		Hostname: resolved.Hostname,
		User:     resolved.User,
		Port:     resolved.Port,
	}
	if len(resolved.IdentityFiles) > 0 {
		entry.IdentityFile = resolved.IdentityFiles[0]
	}
	return entry
}

func expandSSHTokens(value string, resolved *ResolvedSSHConfig) string {
	if value == "" || resolved == nil {
		return value
	}

	localUser, _ := user.Current()
	localUserName := ""
	homeDir := ""
	if localUser != nil {
		localUserName = localUser.Username
		homeDir = localUser.HomeDir
	}

	localHost, _ := os.Hostname()
	shortLocalHost := localHost
	if idx := strings.IndexByte(shortLocalHost, '.'); idx > 0 {
		shortLocalHost = shortLocalHost[:idx]
	}

	replacements := map[string]string{
		"%h": resolved.Hostname,
		"%n": resolved.Alias,
		"%p": strconv.Itoa(resolved.Port),
		"%r": resolved.User,
		"%u": localUserName,
		"%d": homeDir,
		"%l": localHost,
		"%L": shortLocalHost,
	}

	for token, replacement := range replacements {
		value = strings.ReplaceAll(value, token, replacement)
	}

	return os.ExpandEnv(value)
}

func expandSSHPathValue(value string, resolved *ResolvedSSHConfig) string {
	value = strings.TrimSpace(expandSSHTokens(value, resolved))
	if value == "" {
		return value
	}

	if strings.HasPrefix(value, "~/") {
		homeDir, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(homeDir, value[2:])
		}
	}

	return value
}

func resolveIdentityFilesForAuth(resolved *ResolvedSSHConfig) []string {
	files := make([]string, 0, len(resolved.IdentityFiles)+4)
	for _, identityFile := range resolved.IdentityFiles {
		files = append(files, expandSSHPathValue(identityFile, resolved))
	}

	if len(files) == 0 && !resolved.IdentitiesOnly {
		homeDir, err := os.UserHomeDir()
		if err == nil {
			defaults := []string{
				filepath.Join(homeDir, ".ssh", "id_ed25519"),
				filepath.Join(homeDir, ".ssh", "id_ecdsa"),
				filepath.Join(homeDir, ".ssh", "id_rsa"),
				filepath.Join(homeDir, ".ssh", "id_dsa"),
			}
			for _, candidate := range defaults {
				if _, err := os.Stat(candidate); err == nil {
					files = append(files, candidate)
				}
			}
		}
	}

	return uniqueStrings(files)
}

func resolveKnownHostsPaths(resolved *ResolvedSSHConfig) []string {
	paths := make([]string, 0, len(resolved.UserKnownHostsFiles))
	for _, path := range resolved.UserKnownHostsFiles {
		expanded := expandSSHPathValue(path, resolved)
		if expanded != "" {
			paths = append(paths, expanded)
		}
	}
	if len(paths) == 0 {
		homeDir, err := os.UserHomeDir()
		if err == nil {
			paths = append(paths, filepath.Join(homeDir, ".ssh", "known_hosts"))
		}
	}
	return uniqueStrings(paths)
}

func openSSHAgent(resolved *ResolvedSSHConfig) (*sshAgentHandle, error) {
	socketPath, enabled, err := getSSHAgentSocketPath(resolved)
	if err != nil || !enabled {
		return nil, err
	}
	if socketPath == "" {
		return nil, nil
	}

	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return nil, err
	}

	return &sshAgentHandle{
		Client: agent.NewClient(conn),
		Conn:   conn,
	}, nil
}

func getSSHAgentSocketPath(resolved *ResolvedSSHConfig) (string, bool, error) {
	value := strings.TrimSpace(resolved.IdentityAgent)
	if strings.EqualFold(value, "none") {
		return "", false, nil
	}

	if value == "" {
		value = os.Getenv("SSH_AUTH_SOCK")
	}

	if strings.HasPrefix(value, "$") {
		value = os.Getenv(strings.TrimPrefix(value, "$"))
	}

	value = expandSSHPathValue(value, resolved)
	if value == "" {
		return "", false, nil
	}

	return value, true, nil
}

func promptPasswordMatchesResolved(promptHost string, entry SSHConfigEntry, resolved *ResolvedSSHConfig) bool {
	promptHost = strings.TrimSpace(promptHost)
	if promptHost == "" {
		return false
	}

	return strings.EqualFold(promptHost, entry.Host) ||
		strings.EqualFold(promptHost, resolved.Alias) ||
		strings.EqualFold(promptHost, resolved.Hostname)
}

func promptIdentityMatches(promptIdentityFile, identityFile string) bool {
	if promptIdentityFile == "" || identityFile == "" {
		return false
	}
	return filepath.Clean(promptIdentityFile) == filepath.Clean(identityFile)
}

func buildSSHAuthMethods(entry SSHConfigEntry, resolved *ResolvedSSHConfig, prompt sshPromptInputs, agentHandle *sshAgentHandle) (*sshAuthBuildResult, error) {
	result := &sshAuthBuildResult{
		Methods: make([]ssh.AuthMethod, 0, 4),
	}

	var agentSigners []ssh.Signer
	if !resolved.IdentitiesOnly && agentHandle != nil && agentHandle.Client != nil {
		signers, err := agentHandle.Client.Signers()
		if err != nil {
			log.Printf("⚠️ Failed to read ssh-agent signers for %s: %v", resolved.Alias, err)
		} else if len(signers) > 0 {
			agentSigners = signers
			result.Methods = append(result.Methods, ssh.PublicKeys(signers...))
		}
	}

	identityFiles := resolveIdentityFilesForAuth(resolved)
	localSigners := make([]ssh.Signer, 0, len(identityFiles))
	var firstDeferredPrompt error

	for _, identityFile := range identityFiles {
		if identityFile == "" {
			continue
		}

		keyBytes, err := os.ReadFile(identityFile)
		if err != nil {
			log.Printf("⚠️ Failed to read identity file %s: %v", identityFile, err)
			continue
		}

		explicitKeyPassphrase := ""
		if promptIdentityMatches(prompt.KeyIdentityFile, identityFile) {
			explicitKeyPassphrase = prompt.KeyPassphrase
		}

		signer, rawKey, promptErr := parseIdentitySigner(entry, identityFile, keyBytes, explicitKeyPassphrase)
		if promptErr != nil {
			if len(agentSigners) > 0 || len(localSigners) > 0 {
				if firstDeferredPrompt == nil {
					firstDeferredPrompt = promptErr
				}
				continue
			}
			return nil, promptErr
		}
		if signer == nil {
			continue
		}

		localSigners = append(localSigners, signer)
		if rawKey != nil && agentHandle != nil && agentHandle.Client != nil && (resolved.AddKeysToAgent || resolved.UseKeychain) {
			if err := agentHandle.Client.Add(agent.AddedKey{PrivateKey: rawKey, Comment: identityFile}); err != nil {
				log.Printf("⚠️ Failed to add key to ssh-agent (%s): %v", identityFile, err)
			}
		}
	}

	if len(localSigners) > 0 {
		result.Methods = append(result.Methods, ssh.PublicKeys(localSigners...))
	}
	result.DeferredPrompt = firstDeferredPrompt

	passwordForAuth := ""
	if prompt.Password != "" && promptPasswordMatchesResolved(prompt.PasswordHost, entry, resolved) {
		passwordForAuth = prompt.Password
		result.UsedPromptPassword = true
	} else {
		cachedPassword, hasCachedPassword, err := getCachedSSHPassword(entry)
		if err != nil {
			log.Printf("⚠️ Failed to read cached SSH password for %s: %v", resolved.Alias, err)
		} else if hasCachedPassword {
			passwordForAuth = cachedPassword
			result.UsingCachedPassword = true
		}
	}

	if passwordForAuth != "" && resolved.PasswordAuthEnabled {
		result.Methods = append(result.Methods,
			ssh.Password(passwordForAuth),
			ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = passwordForAuth
				}
				return answers, nil
			}),
		)
	}

	if len(result.Methods) == 0 {
		if result.DeferredPrompt != nil {
			return nil, result.DeferredPrompt
		}
		if resolved.PasswordAuthEnabled {
			return nil, newSSHPasswordRequiredError("missing", resolved.Alias, "Password required for SSH connection")
		}
		return nil, fmt.Errorf("no authentication method configured for %s", resolved.Alias)
	}

	return result, nil
}

func parseIdentitySigner(entry SSHConfigEntry, identityFile string, keyBytes []byte, explicitKeyPassphrase string) (ssh.Signer, interface{}, error) {
	signer, err := ssh.ParsePrivateKey(keyBytes)
	if err == nil {
		rawKey, rawErr := ssh.ParseRawPrivateKey(keyBytes)
		if rawErr != nil {
			rawKey = nil
		}
		return signer, rawKey, nil
	}

	var missingPassphrase *ssh.PassphraseMissingError
	if !errors.As(err, &missingPassphrase) {
		return nil, nil, fmt.Errorf("failed to parse private key %s: %v", identityFile, err)
	}

	passphraseToUse := explicitKeyPassphrase
	usingCachedPassphrase := false
	usingPromptPassphrase := explicitKeyPassphrase != ""

	if passphraseToUse == "" {
		cachedPassphrase, hasCachedPassphrase, cacheErr := getCachedSSHKeyPassphrase(identityFile)
		if cacheErr != nil {
			log.Printf("⚠️ Failed to read cached private key passphrase for %s: %v", identityFile, cacheErr)
		} else if hasCachedPassphrase {
			passphraseToUse = cachedPassphrase
			usingCachedPassphrase = true
		}
	}

	if passphraseToUse == "" {
		return nil, nil, newSSHKeyPassphraseRequiredError("missing", identityFile, entry.Host, "Private key passphrase required")
	}

	signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(passphraseToUse))
	if err != nil {
		if usingCachedPassphrase || usingPromptPassphrase {
			if cacheErr := deleteCachedSSHKeyPassphrase(identityFile); cacheErr != nil {
				log.Printf("⚠️ Failed to clear cached private key passphrase for %s: %v", identityFile, cacheErr)
			}
		}

		if errors.Is(err, x509.IncorrectPasswordError) || strings.Contains(strings.ToLower(err.Error()), "incorrect passphrase") {
			if usingPromptPassphrase {
				return nil, nil, newSSHKeyPassphraseInvalidError(identityFile, entry.Host, "Private key passphrase incorrect, please try again")
			}
			return nil, nil, newSSHKeyPassphraseRequiredError("cached_invalid", identityFile, entry.Host, "Cached private key passphrase failed, please re-enter it")
		}

		return nil, nil, fmt.Errorf("failed to decrypt private key %s: %v", identityFile, err)
	}

	rawKey, rawErr := ssh.ParseRawPrivateKeyWithPassphrase(keyBytes, []byte(passphraseToUse))
	if rawErr != nil {
		rawKey = nil
	}

	if usingPromptPassphrase {
		if cacheErr := cacheSSHKeyPassphrase(identityFile, passphraseToUse); cacheErr != nil {
			log.Printf("⚠️ Failed to cache private key passphrase for %s: %v", identityFile, cacheErr)
		}
	}

	return signer, rawKey, nil
}

func buildSSHClientConfig(resolved *ResolvedSSHConfig, prompt sshPromptInputs) (*ssh.ClientConfig, *sshAuthBuildResult, *sshAgentHandle, error) {
	entry := sshConfigEntryFromResolved(resolved)

	agentHandle, err := openSSHAgent(resolved)
	if err != nil {
		log.Printf("⚠️ Failed to connect to ssh-agent for %s: %v", resolved.Alias, err)
		agentHandle = nil
	}

	authResult, err := buildSSHAuthMethods(entry, resolved, prompt, agentHandle)
	if err != nil {
		if agentHandle != nil {
			_ = agentHandle.Close()
		}
		return nil, nil, nil, err
	}

	timeout := resolved.ConnectTimeout
	if timeout <= 0 {
		timeout = SSHConnectTimeout * time.Second
	}

	clientConfig := &ssh.ClientConfig{
		User:            resolved.User,
		HostKeyCallback: knownHostsCallbackWithPaths(resolveKnownHostsPaths(resolved)),
		Timeout:         timeout,
		Auth:            authResult.Methods,
	}

	return clientConfig, authResult, agentHandle, nil
}

func translateSSHConnectError(err error, resolved *ResolvedSSHConfig, authResult *sshAuthBuildResult) error {
	if !isSSHAuthenticationError(err) {
		return fmt.Errorf("failed to connect to %s:%d: %v", resolved.Hostname, resolved.Port, err)
	}

	entry := sshConfigEntryFromResolved(resolved)

	if authResult != nil {
		if authResult.UsingCachedPassword || authResult.UsedPromptPassword {
			if cacheErr := deleteCachedSSHPassword(entry); cacheErr != nil {
				log.Printf("⚠️ Failed to clear cached SSH password for %s: %v", resolved.Alias, cacheErr)
			}

			if authResult.UsedPromptPassword {
				return newSSHPasswordInvalidError(resolved.Alias, "Password incorrect, please try again")
			}

			return newSSHPasswordRequiredError("cached_invalid", resolved.Alias, "Cached password failed, please re-enter password")
		}

		if authResult.DeferredPrompt != nil {
			return authResult.DeferredPrompt
		}
	}

	if resolved.PasswordAuthEnabled {
		return newSSHPasswordRequiredError("missing", resolved.Alias, "Password required for SSH connection")
	}

	return fmt.Errorf("authentication failed for %s: %v", resolved.Alias, err)
}

func dialSingleResolvedSSH(via *ssh.Client, resolved *ResolvedSSHConfig, prompt sshPromptInputs, keepAgent bool) (*ssh.Client, *sshAgentHandle, error) {
	clientConfig, authResult, agentHandle, err := buildSSHClientConfig(resolved, prompt)
	if err != nil {
		return nil, nil, err
	}

	addr := fmt.Sprintf("%s:%d", resolved.Hostname, resolved.Port)

	var client *ssh.Client
	if via == nil {
		if strings.TrimSpace(resolved.ProxyCommand) != "" {
			conn, dialErr := dialViaProxyCommand(resolved)
			if dialErr != nil {
				if agentHandle != nil {
					_ = agentHandle.Close()
				}
				return nil, nil, dialErr
			}
			clientConn, chans, reqs, handshakeErr := ssh.NewClientConn(conn, addr, clientConfig)
			if handshakeErr != nil {
				_ = conn.Close()
				if agentHandle != nil {
					_ = agentHandle.Close()
				}
				return nil, nil, translateSSHConnectError(handshakeErr, resolved, authResult)
			}
			client = ssh.NewClient(clientConn, chans, reqs)
		} else {
			client, err = ssh.Dial("tcp", addr, clientConfig)
			if err != nil {
				if agentHandle != nil {
					_ = agentHandle.Close()
				}
				return nil, nil, translateSSHConnectError(err, resolved, authResult)
			}
		}
	} else {
		conn, dialErr := via.Dial("tcp", addr)
		if dialErr != nil {
			if agentHandle != nil {
				_ = agentHandle.Close()
			}
			return nil, nil, dialErr
		}

		clientConn, chans, reqs, handshakeErr := ssh.NewClientConn(conn, addr, clientConfig)
		if handshakeErr != nil {
			_ = conn.Close()
			if agentHandle != nil {
				_ = agentHandle.Close()
			}
			return nil, nil, translateSSHConnectError(handshakeErr, resolved, authResult)
		}
		client = ssh.NewClient(clientConn, chans, reqs)
	}

	if !keepAgent && agentHandle != nil {
		_ = agentHandle.Close()
		agentHandle = nil
	}

	return client, agentHandle, nil
}

func connectResolvedSSHChain(resolved *ResolvedSSHConfig, prompt sshPromptInputs, seen map[string]struct{}, keepAgent bool) (*ssh.Client, []*ssh.Client, *sshAgentHandle, error) {
	if seen == nil {
		seen = make(map[string]struct{})
	}

	alias := resolved.Alias
	if alias == "" {
		alias = resolved.Hostname
	}
	if _, ok := seen[alias]; ok {
		return nil, nil, nil, fmt.Errorf("proxy loop detected at %s", alias)
	}
	seen[alias] = struct{}{}
	defer delete(seen, alias)

	if strings.TrimSpace(resolved.ProxyJump) != "" {
		return dialViaProxyJump(resolved, prompt, seen, keepAgent)
	}

	client, agentHandle, err := dialSingleResolvedSSH(nil, resolved, prompt, keepAgent)
	return client, nil, agentHandle, err
}

func dialViaProxyJump(resolved *ResolvedSSHConfig, prompt sshPromptInputs, seen map[string]struct{}, keepAgent bool) (*ssh.Client, []*ssh.Client, *sshAgentHandle, error) {
	rawSpecs := strings.Split(resolved.ProxyJump, ",")
	specs := make([]string, 0, len(rawSpecs))
	for _, spec := range rawSpecs {
		spec = strings.TrimSpace(spec)
		if spec != "" {
			specs = append(specs, spec)
		}
	}
	if len(specs) == 0 {
		return nil, nil, nil, fmt.Errorf("invalid ProxyJump for %s", resolved.Alias)
	}

	var proxyClients []*ssh.Client
	closeProxyClients := func() {
		closeSSHClients(proxyClients)
	}

	var currentClient *ssh.Client
	for idx, spec := range specs {
		jumpConfig, err := resolveProxyJumpConfig(spec)
		if err != nil {
			closeProxyClients()
			return nil, nil, nil, err
		}

		if idx == 0 {
			jumpClient, nestedProxyClients, _, err := connectResolvedSSHChain(jumpConfig, prompt, seen, false)
			if err != nil {
				closeProxyClients()
				return nil, nil, nil, err
			}
			proxyClients = append(proxyClients, nestedProxyClients...)
			proxyClients = append(proxyClients, jumpClient)
			currentClient = jumpClient
			continue
		}

		jumpClient, _, err := dialSingleResolvedSSH(currentClient, jumpConfig, prompt, false)
		if err != nil {
			closeProxyClients()
			return nil, nil, nil, err
		}
		proxyClients = append(proxyClients, jumpClient)
		currentClient = jumpClient
	}

	targetClient, agentHandle, err := dialSingleResolvedSSH(currentClient, resolved, prompt, keepAgent)
	if err != nil {
		closeProxyClients()
		return nil, nil, nil, err
	}

	return targetClient, proxyClients, agentHandle, nil
}

func closeSSHClients(clients []*ssh.Client) {
	for i := len(clients) - 1; i >= 0; i-- {
		if clients[i] != nil {
			_ = clients[i].Close()
		}
	}
}

func resolveProxyJumpConfig(spec string) (*ResolvedSSHConfig, error) {
	var alias string
	var userOverride string
	var portOverride int

	if at := strings.LastIndex(spec, "@"); at >= 0 {
		userOverride = spec[:at]
		alias = spec[at+1:]
	} else {
		alias = spec
	}

	if host, port, err := net.SplitHostPort(alias); err == nil {
		alias = host
		if parsedPort, err := strconv.Atoi(port); err == nil {
			portOverride = parsedPort
		}
	} else if lastColon := strings.LastIndex(alias, ":"); lastColon > 0 && !strings.Contains(alias[lastColon+1:], "]") {
		hostPart := alias[:lastColon]
		portPart := alias[lastColon+1:]
		if parsedPort, err := strconv.Atoi(portPart); err == nil {
			alias = hostPart
			portOverride = parsedPort
		}
	}

	resolved, err := resolveSSHConfig(alias)
	if err != nil {
		return nil, err
	}

	if userOverride != "" {
		resolved.User = userOverride
	}
	if portOverride != 0 {
		resolved.Port = portOverride
	}

	return resolved, nil
}

func dialViaProxyCommand(resolved *ResolvedSSHConfig) (net.Conn, error) {
	command := expandSSHTokens(resolved.ProxyCommand, resolved)
	cmd := exec.Command("sh", "-c", command)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	go func() {
		data, readErr := io.ReadAll(stderr)
		if readErr == nil && len(data) > 0 {
			log.Printf("⚠️ ProxyCommand stderr (%s): %s", resolved.Alias, strings.TrimSpace(string(data)))
		}
	}()

	return &proxyCommandConn{
		stdout: stdout,
		stdin:  stdin,
		stderr: stderr,
		cmd:    cmd,
	}, nil
}
