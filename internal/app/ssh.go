package app

type SSHConfigEntry struct {
	ID           string `json:"id"`
	Host         string `json:"host"`
	Hostname     string `json:"hostname"`
	User         string `json:"user"`
	Port         int    `json:"port"`
	IdentityFile string `json:"identityFile"`
}
