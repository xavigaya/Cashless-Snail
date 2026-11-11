package main

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseUID(t *testing.T) {
	uid, err := ParseUID([]byte{0x04, 0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6, 0x90, 0x00})
	if err != nil || uid != "04A1B2C3D4E5F6" {
		t.Fatalf("got %q %v", uid, err)
	}
	if _, err := ParseUID([]byte{0x63, 0x00}); err == nil {
		t.Fatal("expected error for 6300")
	}
	if _, err := ParseUID([]byte{0x01, 0x90, 0x00}); err == nil {
		t.Fatal("expected error for short uid")
	}
}

func TestOriginsAndEvents(t *testing.T) {
	hub := NewHub()
	srv := httptest.NewServer(NewServer(hub, parseOrigins("https://xavigaya.github.io/, http://localhost:5173")))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/events", nil)
	req.Header.Set("Origin", "https://dolenta.example")
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("unauthorised origin: %v %v", res.StatusCode, err)
	}

	req, _ = http.NewRequest("GET", srv.URL+"/events", nil)
	req.Header.Set("Origin", "https://xavigaya.github.io")
	res, err = http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("authorised origin: %v", err)
	}
	defer res.Body.Close()
	if res.Header.Get("Access-Control-Allow-Origin") != "https://xavigaya.github.io" {
		t.Fatal("missing CORS header")
	}
	lines := make(chan string, 10)
	go func() {
		s := bufio.NewScanner(res.Body)
		for s.Scan() {
			if strings.HasPrefix(s.Text(), "data: ") {
				lines <- s.Text()
			}
		}
	}()
	expect := func(want string) {
		select {
		case got := <-lines:
			if !strings.Contains(got, want) {
				t.Fatalf("got %s, want %s", got, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timeout waiting for %s", want)
		}
	}
	expect(`"type":"reader"`)
	hub.Publish(Event{Type: "reader", Connected: true, Reader: "ACS ACR122U"})
	expect(`"connected":true`)
	hub.Publish(Event{Type: "card", UID: "04A1B2C3D4E5F6"})
	expect(`"uid":"04A1B2C3D4E5F6"`)

	pre, _ := http.NewRequest("OPTIONS", srv.URL+"/events", nil)
	pre.Header.Set("Origin", "http://localhost:5173")
	r2, _ := http.DefaultClient.Do(pre)
	if r2.StatusCode != http.StatusNoContent || r2.Header.Get("Access-Control-Allow-Private-Network") != "true" {
		t.Fatalf("preflight: %d", r2.StatusCode)
	}
}
