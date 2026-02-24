package main

import (
	"log"
	"net/http"
	"pixel-art/server"
)

const Port = ":8080"

func main() {
	app := server.NewServer()
	app.LoadCanvasFromFile()

	go app.AutosaveWorker()
	go app.BroadcastWorker()

	// Routing HTTP and WebSocket
	http.Handle("/", http.FileServer(http.Dir("./public")))
	http.HandleFunc("/ws", app.WSHandler)
	http.HandleFunc("/api/save", app.SaveHandler)
	http.HandleFunc("/api/load", app.LoadHandler)
	http.HandleFunc("/api/export", app.ExportPNGHandler)

	log.Printf("Server running at %s\n", Port)
	if err := http.ListenAndServe(Port, nil); err != nil {
		log.Fatal("Server failed:", err)
	}
}
