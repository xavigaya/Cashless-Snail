// Lector NFC de Cashless Snail: fa de pont entre un lector USB (ACR122U o qualsevol lector PC/SC)
// i el backoffice, que s'obre al navegador.
//
// El navegador no pot parlar directament amb un lector de targetes intel·ligents, per això aquest
// programa llegeix l'UID de cada polsera que s'hi apropa i l'envia al backoffice per una connexió
// local (http://127.0.0.1:17321/events, Server-Sent Events). Només hi poden connectar les pàgines
// dels orígens autoritzats (-origen), perquè cap altra web pugui saber quines polseres es llegeixen.
package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
)

// Versió del programa (també la consulta el backoffice).
const version = "1.0.0"

// Orígens que poden connectar per defecte: el backoffice publicat i el de desenvolupament.
const defaultOrigins = "https://xavigaya.github.io,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:3999"

// DefaultPort és el port on escolta; el backoffice el fa servir per defecte.
const DefaultPort = 17321

func main() {
	port := flag.Int("port", DefaultPort, "port local on escolta el pont")
	origins := flag.String("origen", defaultOrigins, "orígens (separats per comes) de les pàgines que poden fer servir el lector")
	readerName := flag.String("lector", "", "nom (o part del nom) del lector a fer servir; per defecte, el primer ACR122 o el primer que hi hagi")
	flag.Parse()

	allowed := parseOrigins(*origins)
	hub := NewHub()

	fmt.Printf("Cashless Snail · Lector NFC %s\n", version)
	fmt.Printf("Orígens autoritzats: %s\n", strings.Join(allowed, ", "))

	go runReader(hub, *readerName)

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		var opErr *net.OpError
		if errors.As(err, &opErr) {
			log.Printf("No es pot obrir %s: potser el programa ja està obert en una altra finestra.", addr)
		}
		log.Print(err)
		os.Exit(1)
	}
	fmt.Printf("Escoltant a http://%s · deixa aquesta finestra oberta mentre facis servir el lector.\n", addr)
	if err := http.Serve(listener, NewServer(hub, allowed)); err != nil {
		log.Fatal(err)
	}
}

func parseOrigins(list string) []string {
	var out []string
	for _, o := range strings.Split(list, ",") {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o != "" {
			out = append(out, o)
		}
	}
	return out
}
