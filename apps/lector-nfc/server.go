package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
)

// Event és el que s'envia al backoffice.
//   - reader:  estat del lector (connectat o no, i el nom)
//   - card:    s'ha apropat una polsera (uid en hexadecimal, majúscules)
//   - removed: s'ha retirat la polsera
//   - error:   la polsera no s'ha pogut llegir
type Event struct {
	Type      string `json:"type"`
	Reader    string `json:"reader,omitempty"`
	Connected bool   `json:"connected,omitempty"`
	UID       string `json:"uid,omitempty"`
	Message   string `json:"message,omitempty"`
}

// Hub reparteix els esdeveniments del lector entre tots els navegadors connectats.
type Hub struct {
	mu      sync.Mutex
	clients map[chan Event]struct{}
	status  Event
}

func NewHub() *Hub {
	return &Hub{clients: map[chan Event]struct{}{}, status: Event{Type: "reader", Connected: false}}
}

func (h *Hub) Subscribe() (chan Event, Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan Event, 16)
	h.clients[ch] = struct{}{}
	return ch, h.status
}

func (h *Hub) Unsubscribe(ch chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, ch)
}

func (h *Hub) Publish(e Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if e.Type == "reader" {
		if e == h.status {
			return
		}
		h.status = e
	}
	for ch := range h.clients {
		select {
		case ch <- e:
		default: // un navegador que no llegeix no bloqueja els altres
		}
	}
}

func (h *Hub) Status() Event {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.status
}

// NewServer serveix /estat (JSON) i /events (Server-Sent Events) només als orígens autoritzats.
func NewServer(hub *Hub, allowed []string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/estat", func(w http.ResponseWriter, r *http.Request) {
		if !cors(w, r, allowed) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"version": version, "reader": hub.Status().Reader, "connected": hub.Status().Connected})
	})
	mux.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		if !cors(w, r, allowed) {
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming no disponible", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "keep-alive")

		ch, status := hub.Subscribe()
		defer hub.Unsubscribe(ch)
		send(w, status)
		flusher.Flush()

		ping := time.NewTicker(20 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case e := <-ch:
				send(w, e)
				flusher.Flush()
			case <-ping.C:
				fmt.Fprint(w, ": ping\n\n")
				flusher.Flush()
			}
		}
	})
	return mux
}

func send(w http.ResponseWriter, e Event) {
	data, _ := json.Marshal(e)
	fmt.Fprintf(w, "data: %s\n\n", data)
}

// cors respon a la comprovació prèvia dels navegadors i rebutja els orígens no autoritzats.
// Una petició sense Origin (p. ex. curl des del mateix ordinador) s'accepta.
func cors(w http.ResponseWriter, r *http.Request, allowed []string) bool {
	origin := strings.TrimRight(r.Header.Get("Origin"), "/")
	if origin != "" {
		if !slices.Contains(allowed, origin) {
			http.Error(w, "origen no autoritzat: afegeix-lo amb -origen", http.StatusForbidden)
			return false
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		// Chrome demana permís abans que una web pública parli amb un programa de l'ordinador.
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET")
		w.WriteHeader(http.StatusNoContent)
		return false
	}
	if r.Method != http.MethodGet {
		http.Error(w, "només GET", http.StatusMethodNotAllowed)
		return false
	}
	return true
}

// ParseUID interpreta la resposta a l'ordre GET DATA (FF CA 00 00 00): UID seguit de 90 00.
func ParseUID(resp []byte) (string, error) {
	if len(resp) < 2 {
		return "", fmt.Errorf("resposta massa curta")
	}
	sw1, sw2 := resp[len(resp)-2], resp[len(resp)-1]
	if sw1 != 0x90 || sw2 != 0x00 {
		return "", fmt.Errorf("el lector no ha pogut llegir l'UID (codi %02X%02X)", sw1, sw2)
	}
	uid := resp[:len(resp)-2]
	if len(uid) < 4 || len(uid) > 10 {
		return "", fmt.Errorf("UID de mida inesperada (%d bytes)", len(uid))
	}
	return strings.ToUpper(fmt.Sprintf("%x", uid)), nil
}
