package app

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

const sshServerInfoCommand = `sh <<'__XTFM_SERVER_INFO__'
pretty_name=""
if [ -r /etc/os-release ]; then
  pretty_name=$(awk -F= '/^PRETTY_NAME=/{gsub(/^"|"$/, "", $2); print $2; exit}' /etc/os-release 2>/dev/null)
fi
if [ -z "$pretty_name" ]; then
  pretty_name=$(uname -sr 2>/dev/null)
fi

cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null)
if [ -z "$cpu_cores" ]; then
  cpu_cores=$(nproc 2>/dev/null)
fi

cpu_model=$(awk -F: '/^(model name|Hardware|Processor)[[:space:]]*:/{sub(/^[[:space:]]+/, "", $2); print $2; exit}' /proc/cpuinfo 2>/dev/null)
if [ -z "$cpu_model" ]; then
  cpu_model=$(uname -m 2>/dev/null)
fi

mem_total_kb=$(awk '/^MemTotal:/{print $2; exit}' /proc/meminfo 2>/dev/null)
mem_available_kb=$(awk '/^MemAvailable:/{print $2; exit}' /proc/meminfo 2>/dev/null)
if [ -z "$mem_available_kb" ]; then
  mem_available_kb=$(awk '/^MemFree:/{print $2; exit}' /proc/meminfo 2>/dev/null)
fi

disk_stats=$(df -kP / 2>/dev/null | awk 'NR==2 {print $2, $3, $4; exit}')
disk_total_kb=$(printf '%s' "$disk_stats" | awk '{print $1}')
disk_used_kb=$(printf '%s' "$disk_stats" | awk '{print $2}')
disk_available_kb=$(printf '%s' "$disk_stats" | awk '{print $3}')

uptime_seconds=$(awk '{print int($1); exit}' /proc/uptime 2>/dev/null)
load_avg=$(awk '{print $1; exit}' /proc/loadavg 2>/dev/null)
kernel=$(uname -r 2>/dev/null)
arch=$(uname -m 2>/dev/null)

iface=$(ip route show default 2>/dev/null | awk 'NR==1 {for (i = 1; i <= NF; i++) if ($i == "dev") {print $(i + 1); exit}}')
if [ -z "$iface" ]; then
  iface=$(awk -F: 'NR > 2 {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1); if ($1 != "lo") {print $1; exit}}' /proc/net/dev 2>/dev/null)
fi

net_pair=""
if [ -n "$iface" ]; then
  net_pair=$(awk -F'[: ]+' -v dev="$iface" '$1 == dev {print $2, $10; exit}' /proc/net/dev 2>/dev/null)
fi
net_rx_bytes=$(printf '%s' "$net_pair" | awk '{print $1}')
net_tx_bytes=$(printf '%s' "$net_pair" | awk '{print $2}')

printf 'distro=%s\n' "$pretty_name"
printf 'kernel=%s\n' "$kernel"
printf 'architecture=%s\n' "$arch"
printf 'cpu_cores=%s\n' "$cpu_cores"
printf 'cpu_model=%s\n' "$cpu_model"
printf 'memory_total_kb=%s\n' "$mem_total_kb"
printf 'memory_available_kb=%s\n' "$mem_available_kb"
printf 'disk_total_kb=%s\n' "$disk_total_kb"
printf 'disk_used_kb=%s\n' "$disk_used_kb"
printf 'disk_available_kb=%s\n' "$disk_available_kb"
printf 'uptime_seconds=%s\n' "$uptime_seconds"
printf 'load_average_1=%s\n' "$load_avg"
printf 'network_interface=%s\n' "$iface"
printf 'network_rx_bytes=%s\n' "$net_rx_bytes"
printf 'network_tx_bytes=%s\n' "$net_tx_bytes"
__XTFM_SERVER_INFO__
`

type sshServerInfoSample struct {
	Interface   string
	RxBytes     uint64
	TxBytes     uint64
	CollectedAt time.Time
}

type SSHServerInfo struct {
	Distro               string  `json:"distro"`
	Kernel               string  `json:"kernel"`
	Architecture         string  `json:"architecture"`
	CPUCores             uint64  `json:"cpuCores"`
	CPUModel             string  `json:"cpuModel"`
	MemoryTotalBytes     uint64  `json:"memoryTotalBytes"`
	MemoryUsedBytes      uint64  `json:"memoryUsedBytes"`
	MemoryAvailableBytes uint64  `json:"memoryAvailableBytes"`
	DiskTotalBytes       uint64  `json:"diskTotalBytes"`
	DiskUsedBytes        uint64  `json:"diskUsedBytes"`
	DiskAvailableBytes   uint64  `json:"diskAvailableBytes"`
	UptimeSeconds        uint64  `json:"uptimeSeconds"`
	LoadAverage1         string  `json:"loadAverage1"`
	NetworkInterface     string  `json:"networkInterface"`
	NetworkRxBytesPerSec float64 `json:"networkRxBytesPerSec"`
	NetworkTxBytesPerSec float64 `json:"networkTxBytesPerSec"`
	NetworkRateReady     bool    `json:"networkRateReady"`
	CollectedAtUnix      int64   `json:"collectedAtUnix"`
}

type sshServerInfoSnapshot struct {
	Distro               string
	Kernel               string
	Architecture         string
	CPUCores             uint64
	CPUModel             string
	MemoryTotalBytes     uint64
	MemoryAvailableBytes uint64
	DiskTotalBytes       uint64
	DiskUsedBytes        uint64
	DiskAvailableBytes   uint64
	UptimeSeconds        uint64
	LoadAverage1         string
	NetworkInterface     string
	NetworkRxBytes       uint64
	NetworkTxBytes       uint64
}

// GetSSHServerInfo collects a compact machine summary for the connected SSH host.
func (a *App) GetSSHServerInfo(sessionID string) (*SSHServerInfo, error) {
	output, err := a.ExecuteCommand(sessionID, sshServerInfoCommand)
	if err != nil {
		return nil, err
	}

	snapshot, err := parseSSHServerInfoSnapshot(output)
	if err != nil {
		return nil, err
	}

	info := &SSHServerInfo{
		Distro:               snapshot.Distro,
		Kernel:               snapshot.Kernel,
		Architecture:         snapshot.Architecture,
		CPUCores:             snapshot.CPUCores,
		CPUModel:             snapshot.CPUModel,
		MemoryTotalBytes:     snapshot.MemoryTotalBytes,
		MemoryAvailableBytes: snapshot.MemoryAvailableBytes,
		DiskTotalBytes:       snapshot.DiskTotalBytes,
		DiskUsedBytes:        snapshot.DiskUsedBytes,
		DiskAvailableBytes:   snapshot.DiskAvailableBytes,
		UptimeSeconds:        snapshot.UptimeSeconds,
		LoadAverage1:         snapshot.LoadAverage1,
		NetworkInterface:     snapshot.NetworkInterface,
		CollectedAtUnix:      time.Now().Unix(),
	}

	if snapshot.MemoryTotalBytes >= snapshot.MemoryAvailableBytes {
		info.MemoryUsedBytes = snapshot.MemoryTotalBytes - snapshot.MemoryAvailableBytes
	}

	sshManager.mu.RLock()
	session, exists := sshManager.sessions[sessionID]
	sshManager.mu.RUnlock()
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	now := time.Now()
	currentSample := sshServerInfoSample{
		Interface:   snapshot.NetworkInterface,
		RxBytes:     snapshot.NetworkRxBytes,
		TxBytes:     snapshot.NetworkTxBytes,
		CollectedAt: now,
	}

	session.mu.Lock()
	previousSample := session.LastServerInfoSample
	session.LastServerInfoSample = &currentSample
	session.mu.Unlock()

	if previousSample != nil &&
		previousSample.Interface != "" &&
		previousSample.Interface == currentSample.Interface &&
		currentSample.CollectedAt.After(previousSample.CollectedAt) &&
		currentSample.RxBytes >= previousSample.RxBytes &&
		currentSample.TxBytes >= previousSample.TxBytes {
		elapsedSeconds := currentSample.CollectedAt.Sub(previousSample.CollectedAt).Seconds()
		if elapsedSeconds > 0 {
			info.NetworkRxBytesPerSec = float64(currentSample.RxBytes-previousSample.RxBytes) / elapsedSeconds
			info.NetworkTxBytesPerSec = float64(currentSample.TxBytes-previousSample.TxBytes) / elapsedSeconds
			info.NetworkRateReady = true
		}
	}

	return info, nil
}

func parseSSHServerInfoSnapshot(output string) (*sshServerInfoSnapshot, error) {
	fields := make(map[string]string)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		fields[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
	}

	snapshot := &sshServerInfoSnapshot{
		Distro:           fields["distro"],
		Kernel:           fields["kernel"],
		Architecture:     fields["architecture"],
		CPUCores:         parseUint64Field(fields["cpu_cores"]),
		CPUModel:         fields["cpu_model"],
		UptimeSeconds:    parseUint64Field(fields["uptime_seconds"]),
		LoadAverage1:     fields["load_average_1"],
		NetworkInterface: fields["network_interface"],
		NetworkRxBytes:   parseUint64Field(fields["network_rx_bytes"]),
		NetworkTxBytes:   parseUint64Field(fields["network_tx_bytes"]),
	}

	snapshot.MemoryTotalBytes = parseUint64Field(fields["memory_total_kb"]) * 1024
	snapshot.MemoryAvailableBytes = parseUint64Field(fields["memory_available_kb"]) * 1024
	snapshot.DiskTotalBytes = parseUint64Field(fields["disk_total_kb"]) * 1024
	snapshot.DiskUsedBytes = parseUint64Field(fields["disk_used_kb"]) * 1024
	snapshot.DiskAvailableBytes = parseUint64Field(fields["disk_available_kb"]) * 1024

	return snapshot, nil
}

func parseUint64Field(value string) uint64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}

	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0
	}

	return parsed
}
