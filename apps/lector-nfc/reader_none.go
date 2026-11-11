//go:build !windows && !pcsc

package main

import "log"

// Compilació sense PC/SC (p. ex. Linux o macOS sense l'etiqueta «pcsc»): el servidor funciona,
// però no llegeix cap lector. Per compilar-lo amb lector: go build -tags pcsc
func runReader(hub *Hub, _ string) {
	log.Print("Aquesta compilació no inclou el suport de lectors (PC/SC). Compila amb: go build -tags pcsc")
	hub.Publish(Event{Type: "reader", Connected: false, Message: "compilació sense suport de lectors"})
}
