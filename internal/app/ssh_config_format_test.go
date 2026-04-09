package app

import "testing"

func TestFormatSSHConfigSpacingUsesSingleBlankLineBetweenHostBlocks(t *testing.T) {
	input := "ServerAliveInterval 30\nHost chuanjiabao\n  HostName 156.226.171.29\n  User root\nHost basemind\n  HostName platform.basemind.com\n  User demo\n\n\nHost home\n  HostName 101.126.150.28\n  User xd\n"
	want := "ServerAliveInterval 30\nHost chuanjiabao\n  HostName 156.226.171.29\n  User root\n\nHost basemind\n  HostName platform.basemind.com\n  User demo\n\nHost home\n  HostName 101.126.150.28\n  User xd\n"

	got := formatSSHConfigSpacing(input)
	if got != want {
		t.Fatalf("unexpected formatted ssh config:\nwant:\n%s\ngot:\n%s", want, got)
	}
}

func TestFormatSSHConfigSpacingKeepsCommentsInsideHostBlocks(t *testing.T) {
	input := "Host alpha\n  HostName alpha.example.com\n  # keep this with alpha\n\nHost beta\n  HostName beta.example.com\n"
	want := "Host alpha\n  HostName alpha.example.com\n  # keep this with alpha\n\nHost beta\n  HostName beta.example.com\n"

	got := formatSSHConfigSpacing(input)
	if got != want {
		t.Fatalf("unexpected formatted ssh config:\nwant:\n%s\ngot:\n%s", want, got)
	}
}
