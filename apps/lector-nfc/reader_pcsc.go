//go:build windows || pcsc

package main

import (
	"errors"
	"log"
	"strings"
	"time"

	"github.com/ebfe/scard"
)

// Ordre APDU estàndard PC/SC per obtenir l'UID de la targeta (l'ACR122U la implementa).
var getUID = []byte{0xFF, 0xCA, 0x00, 0x00, 0x00}

// runReader espera lectors i polseres per sempre. Si es desconnecta el lector, el torna a buscar.
func runReader(hub *Hub, wanted string) {
	for {
		if err := watch(hub, wanted); err != nil {
			log.Printf("Lector: %v", err)
		}
		hub.Publish(Event{Type: "reader", Connected: false})
		time.Sleep(2 * time.Second)
	}
}

func watch(hub *Hub, wanted string) error {
	ctx, err := scard.EstablishContext()
	if err != nil {
		return errors.New("el servei de targetes intel·ligents no està disponible (a Windows: servei «Tarjeta inteligente»; a Linux: pcscd)")
	}
	defer ctx.Release()

	readers, err := ctx.ListReaders()
	if err != nil || len(readers) == 0 {
		return nil // encara no hi ha cap lector connectat
	}
	reader := pickReader(readers, wanted)
	if reader == "" {
		return nil
	}
	log.Printf("Lector connectat: %s", reader)
	hub.Publish(Event{Type: "reader", Connected: true, Reader: reader})

	states := []scard.ReaderState{{Reader: reader, CurrentState: scard.StateUnaware}}
	present := false
	for {
		err := ctx.GetStatusChange(states, 2*time.Second)
		if errors.Is(err, scard.ErrTimeout) {
			continue
		}
		if err != nil {
			return err
		}
		ev := states[0].EventState
		states[0].CurrentState = ev &^ scard.StateChanged
		if ev&(scard.StateUnknown|scard.StateUnavailable) != 0 {
			log.Printf("Lector desconnectat")
			return nil
		}
		nowPresent := ev&scard.StatePresent != 0 && ev&scard.StateMute == 0
		if nowPresent && !present {
			uid, err := readUID(ctx, reader)
			if err != nil {
				log.Printf("No s'ha pogut llegir la polsera: %v", err)
				hub.Publish(Event{Type: "error", Message: err.Error()})
			} else {
				log.Printf("Polsera %s", uid)
				hub.Publish(Event{Type: "card", UID: uid})
			}
		}
		if !nowPresent && present {
			hub.Publish(Event{Type: "removed"})
		}
		present = nowPresent
	}
}

func pickReader(readers []string, wanted string) string {
	match := func(sub string) string {
		for _, r := range readers {
			if strings.Contains(strings.ToLower(r), strings.ToLower(sub)) {
				return r
			}
		}
		return ""
	}
	if wanted != "" {
		return match(wanted)
	}
	if r := match("acr122"); r != "" {
		return r
	}
	return readers[0]
}

func readUID(ctx *scard.Context, reader string) (string, error) {
	card, err := ctx.Connect(reader, scard.ShareShared, scard.ProtocolAny)
	if err != nil {
		return "", err
	}
	defer card.Disconnect(scard.LeaveCard)
	resp, err := card.Transmit(getUID)
	if err != nil {
		return "", err
	}
	return ParseUID(resp)
}
